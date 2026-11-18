import { Prisma, type PrismaClient } from "@prisma/client";
import {
  roleSchema,
  type AuditLogEntry,
  type AuditLogQuery,
  type CatalogQuery,
  type DeviceCreateInput,
  type DeviceUpdateInput,
  type RegisteredDevice,
  type StaffAccount,
  type StaffCreateInput,
  type StaffUpdateInput,
  type StoreSettings,
  type StoreSettingsInput,
} from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest, hashPassword, newToken } from "../security";
import { audit } from "./auth";
import { translateDuplicate, type StoreActor } from "./catalog";
import { pageMeta, resolveOrder } from "./pagination";

const fields = {
  name: true, address: true, taxId: true, vatActive: true, vatRate: true,
  receiptHeader: true, receiptFooter: true, receiptLogo: true,
} satisfies Prisma.StoreSelect;

const staffSelect = {
  id: true,
  username: true,
  name: true,
  disabledAt: true,
  roles: { include: { role: { select: { code: true } } }, orderBy: { role: { code: "asc" as const } } },
} satisfies Prisma.UserSelect;

const deviceSelect = {
  id: true,
  name: true,
  createdAt: true,
  disabledAt: true,
  pinHash: true,
  isWebDevice: true,
  sessions: {
    where: { revokedAt: null },
    select: { expiresAt: true, lockedAt: true, user: { select: { name: true, username: true } } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.DeviceSelect;

function dto({ vatRate, ...store }: Prisma.StoreGetPayload<{ select: typeof fields }>): StoreSettings {
  return { ...store, vatRate: vatRate?.toFixed(2) ?? null };
}

type DbClient = PrismaClient | Prisma.TransactionClient;

async function findReferencedUsers(db: DbClient, storeId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const selection = Prisma.join(userIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u
    WHERE u.store_id = CAST(${storeId} AS uuid) AND u.id IN (${selection})
      AND (
        EXISTS (SELECT 1 FROM sales WHERE cashier_id = u.id)
        OR EXISTS (SELECT 1 FROM cash_shifts WHERE cashier_id = u.id OR approved_by = u.id)
        OR EXISTS (SELECT 1 FROM audit_logs WHERE user_id = u.id)
        OR EXISTS (SELECT 1 FROM stock_counts WHERE submitted_by_id = u.id OR reviewed_by_id = u.id)
        OR EXISTS (SELECT 1 FROM approval_decisions WHERE manager_id = u.id)
        OR EXISTS (SELECT 1 FROM share_transactions WHERE approved_by = u.id)
        OR EXISTS (SELECT 1 FROM accounting_periods WHERE locked_by = u.id)
        OR EXISTS (SELECT 1 FROM dividend_runs WHERE calculated_by = u.id)
        OR EXISTS (SELECT 1 FROM payouts WHERE paid_by_user_id = u.id)
        OR EXISTS (SELECT 1 FROM purchase_adjustments WHERE approved_by = u.id)
        OR EXISTS (SELECT 1 FROM cash_movements WHERE actor_id = u.id)
      )
  `;
  return new Set(rows.map((r) => r.id));
}

async function findReferencedDevices(db: DbClient, storeId: string, deviceIds: string[]): Promise<Set<string>> {
  if (!deviceIds.length) return new Set();
  const selection = Prisma.join(deviceIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT d.id FROM devices d
    WHERE d.store_id = CAST(${storeId} AS uuid) AND d.id IN (${selection})
      AND (
        EXISTS (SELECT 1 FROM sales WHERE terminal_id = d.id)
        OR EXISTS (SELECT 1 FROM cash_shifts WHERE device_id = d.id)
        OR EXISTS (SELECT 1 FROM held_sales WHERE terminal_id = d.id AND held = true AND consumed = false)
      )
  `;
  return new Set(rows.map((r) => r.id));
}

function staffDto(
  user: Prisma.UserGetPayload<{ select: typeof staffSelect }>,
  currentUserId: string | undefined,
  referenced: boolean,
): StaffAccount {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    isActive: user.disabledAt === null,
    roles: user.roles.map(({ role }) => roleSchema.parse(role.code)),
    canDelete: user.id !== currentUserId && !referenced,
  };
}

function deviceDto(
  device: Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>,
  currentDeviceId: string | undefined,
  referenced: boolean,
  nowTimestamp = Date.now(),
): RegisteredDevice {
  const session = device.sessions[0];
  const isSessionActive = !!session && session.expiresAt.getTime() > nowTimestamp;
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt.toISOString(),
    isActive: device.disabledAt === null,
    hasPin: device.pinHash !== null,
    isWebDevice: device.isWebDevice,
    canDelete: device.id !== currentDeviceId && !isSessionActive && !referenced,
    activeUser: isSessionActive ? `${session.user.name} (${session.user.username})` : null,
    sessionLocked: isSessionActive && session.lockedAt !== null,
  };
}

export function createSettings(db: PrismaClient, now: () => number = Date.now) {
  return {
    async read(storeId: string) {
      return dto(await db.store.findUniqueOrThrow({ where: { id: storeId }, select: fields }));
    },
    async save(actor: StoreActor, input: StoreSettingsInput) {
      return db.$transaction(async (tx) => {
        const updated = await tx.store.update({ where: { id: actor.storeId }, data: input, select: fields });
        await audit(tx, actor, "STORE_SETTINGS_UPDATED");
        return dto(updated);
      });
    },
    async users(actor: StoreActor, query?: CatalogQuery & { status?: "active" | "inactive" | "all" }) {
      const q = query?.q ?? "";
      const status = query?.status ?? "all";
      const where: Prisma.UserWhereInput = {
        storeId: actor.storeId,
        ...(status !== "all" && { disabledAt: status === "active" ? null : { not: null } }),
        ...(q && { OR: [{ username: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }),
      };
      const orderBy = resolveOrder<Prisma.UserOrderByWithRelationInput>(
        {
          username: (dir) => [{ username: dir }, { id: "asc" }],
          name: (dir) => [{ name: dir }, { id: "asc" }],
          isActive: (dir) => [{ disabledAt: dir === "asc" ? "desc" : "asc" }, { username: "asc" }],
        },
        [{ username: "asc" }, { id: "asc" }],
        query?.sortBy,
        query?.sortDir,
      );
      if (query?.page) {
        const [rows, total] = await Promise.all([
          db.user.findMany({ where, select: staffSelect, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
          db.user.count({ where }),
        ]);
        const referenced = await findReferencedUsers(db, actor.storeId, rows.map((r) => r.id));
        return { items: rows.map((row) => staffDto(row, actor.userId, referenced.has(row.id))), ...pageMeta(total, query.page, query.limit) };
      }
      const rows = await db.user.findMany({ where, select: staffSelect, orderBy });
      const referenced = await findReferencedUsers(db, actor.storeId, rows.map((r) => r.id));
      return { items: rows.map((row) => staffDto(row, actor.userId, referenced.has(row.id))), nextCursor: null };
    },
    async createUser(actor: StoreActor, input: StaffCreateInput) {
      const [passwordHash, pinHash] = await Promise.all([hashPassword(input.password), hashPassword(input.pin)]);
      return db.$transaction(async (tx) => {
        const roles = await tx.role.findMany({ where: { code: { in: input.roles } }, select: { id: true } });
        if (roles.length !== input.roles.length) throw new ApiError(400, "INVALID_REFERENCE");
        const created = await tx.user.create({
          data: {
            storeId: actor.storeId,
            username: input.username,
            name: input.name,
            passwordHash,
            pinHash,
            roles: { create: roles.map(({ id }) => ({ roleId: id })) },
          },
          select: staffSelect,
        });
        await audit(tx, actor, "USER_CREATED", created.id);
        return staffDto(created, actor.userId, false);
      }).catch(translateDuplicate);
    },
    async updateUser(actor: StoreActor, id: string, input: StaffUpdateInput) {
      if (id === actor.userId && (!input.isActive || !input.roles.includes("ADMIN"))) {
        throw new ApiError(403, "FORBIDDEN");
      }
      const [passwordHash, pinHash] = await Promise.all([
        input.password ? hashPassword(input.password) : undefined,
        input.pin ? hashPassword(input.pin) : undefined,
      ]);
      return db.$transaction(async (tx) => {
        // Serialize admin role / activation changes so two admins cannot demote or disable each other concurrently.
        const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id
          WHERE u.store_id = CAST(${actor.storeId} AS uuid) AND r.code = 'ADMIN' AND u.disabled_at IS NULL
          ORDER BY u.id
          FOR UPDATE OF u
        `;
        const existing = await tx.user.findFirst({ where: { id, storeId: actor.storeId }, select: { id: true, disabledAt: true } });
        if (!existing) throw new ApiError(404, "NOT_FOUND");
        if (!input.isActive || !input.roles.includes("ADMIN")) {
          const remainingAdmins = activeAdmins.filter((admin) => admin.id !== id);
          if (remainingAdmins.length === 0) throw new ApiError(403, "FORBIDDEN");
        }
        const roles = await tx.role.findMany({ where: { code: { in: input.roles } }, select: { id: true } });
        if (roles.length !== input.roles.length) throw new ApiError(400, "INVALID_REFERENCE");
        const timestamp = new Date(now());
        await tx.userRole.deleteMany({ where: { userId: id } });
        const updated = await tx.user.update({
          where: { id },
          data: {
            name: input.name,
            disabledAt: input.isActive ? null : (existing.disabledAt ?? timestamp),
            ...(input.isActive && { loginFails: 0, loginUntil: null, approvalFails: 0, approvalUntil: null }),
            ...(passwordHash && { passwordHash }),
            ...(pinHash && { pinHash }),
            roles: { create: roles.map((role) => ({ roleId: role.id })) },
          },
          select: staffSelect,
        });
        if (!input.isActive || passwordHash || pinHash) {
          await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: timestamp } });
        }
        await audit(tx, actor, "USER_UPDATED", id);
        const referenced = await findReferencedUsers(tx, actor.storeId, [updated.id]);
        return staffDto(updated, actor.userId, referenced.has(updated.id));
      });
    },
    async deleteUser(actor: StoreActor, id: string) {
      if (id === actor.userId) throw new ApiError(403, "FORBIDDEN");
      return db.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { id, storeId: actor.storeId }, select: { id: true } });
        if (!existing) throw new ApiError(404, "NOT_FOUND");
        const referenced = await findReferencedUsers(tx, actor.storeId, [id]);
        if (referenced.has(id)) {
          throw new ApiError(409, "RECORD_IN_USE");
        }
        try {
          await tx.session.deleteMany({ where: { userId: id } });
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.user.delete({ where: { id } });
          await audit(tx, actor, "USER_DELETED", id);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new ApiError(409, "RECORD_IN_USE");
          }
          throw error;
        }
      });
    },
    async devices(actor: StoreActor, query?: CatalogQuery & { status?: "active" | "inactive" | "all" }) {
      const currentNow = now();
      const q = query?.q ?? "";
      const status = query?.status ?? "all";
      const where: Prisma.DeviceWhereInput = {
        storeId: actor.storeId,
        ...(status !== "all" && { disabledAt: status === "active" ? null : { not: null } }),
        ...(q && { name: { contains: q, mode: "insensitive" } }),
        OR: [
          { isWebDevice: false },
          { disabledAt: { not: null } },
          {
            sessions: {
              some: {
                revokedAt: null,
                expiresAt: { gt: new Date(currentNow) },
              },
            },
          },
        ],
      };
      const orderBy = resolveOrder<Prisma.DeviceOrderByWithRelationInput>(
        {
          name: (dir) => [{ name: dir }, { id: "asc" }],
          createdAt: (dir) => [{ createdAt: dir }, { id: "asc" }],
          isActive: (dir) => [{ disabledAt: dir === "asc" ? "desc" : "asc" }, { name: "asc" }],
        },
        [{ createdAt: "asc" }, { id: "asc" }],
        query?.sortBy,
        query?.sortDir,
      );
      if (query?.page) {
        const [rows, total] = await Promise.all([
          db.device.findMany({ where, select: deviceSelect, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
          db.device.count({ where }),
        ]);
        const referenced = await findReferencedDevices(db, actor.storeId, rows.map((r) => r.id));
        return { items: rows.map((row) => deviceDto(row, actor.deviceId, referenced.has(row.id), currentNow)), ...pageMeta(total, query.page, query.limit) };
      }
      const rows = await db.device.findMany({ where, select: deviceSelect, orderBy });
      const referenced = await findReferencedDevices(db, actor.storeId, rows.map((r) => r.id));
      return { items: rows.map((row) => deviceDto(row, actor.deviceId, referenced.has(row.id), currentNow)), nextCursor: null };
    },
    async auditLogs(storeId: string, query: AuditLogQuery) {
      const { q, event, start, end, limit, page = 1, sortBy, sortDir } = query;
      const where: Prisma.AuditLogWhereInput = {
        storeId,
        ...(event && { event }),
        ...((start || end) && {
          createdAt: {
            ...(start && { gte: new Date(Date.parse(start + "T00:00:00.000Z") - 25_200_000) }),
            ...(end && { lt: new Date(Date.parse(end + "T00:00:00.000Z") + 86_400_000 - 25_200_000) }),
          },
        }),
        ...(q && {
          OR: [
            { event: { contains: q, mode: "insensitive" } },
            { reason: { contains: q, mode: "insensitive" } },
            { deviceName: { contains: q, mode: "insensitive" } },
            { user: { name: { contains: q, mode: "insensitive" } } },
            { user: { username: { contains: q, mode: "insensitive" } } },
          ],
        }),
      };
      const orderBy = resolveOrder<Prisma.AuditLogOrderByWithRelationInput>(
        {
          createdAt: (dir) => [{ createdAt: dir }, { id: dir }],
          event: (dir) => [{ event: dir }, { createdAt: "desc" }],
        },
        [{ createdAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          include: { user: { select: { name: true, username: true } } },
        }),
        db.auditLog.count({ where }),
      ]);
      const missingNameDeviceIds = [...new Set(rows.filter((r) => !r.deviceName && r.deviceId).map((r) => r.deviceId!))];
      const devices = missingNameDeviceIds.length
        ? new Map((await db.device.findMany({ where: { id: { in: missingNameDeviceIds } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]))
        : new Map<string, string>();
      const items: AuditLogEntry[] = rows.map((row) => ({
        id: row.id,
        event: row.event,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        userName: row.user?.name ?? null,
        username: row.user?.username ?? null,
        deviceName: row.deviceName ?? (row.deviceId ? (devices.get(row.deviceId) ?? null) : null),
      }));
      return { items, ...pageMeta(total, page, limit) };
    },
    async createDevice(actor: StoreActor, input: DeviceCreateInput) {
      const pinHash = await hashPassword(input.pin);
      return db.$transaction(async (tx) => {
        const created = await tx.device.create({
          data: {
            storeId: actor.storeId,
            name: input.name,
            tokenHash: digest(newToken()),
            pinHash,
          },
          select: deviceSelect,
        });
        await audit(tx, actor, "DEVICE_CREATED", created.id);
        return deviceDto(created, actor.deviceId, false, now());
      });
    },
    async updateDevice(actor: StoreActor, id: string, input: DeviceUpdateInput) {
      if (id === actor.deviceId && (!input.isActive || input.revokeSessions)) throw new ApiError(403, "FORBIDDEN");
      const pinHash = input.pin ? await hashPassword(input.pin) : undefined;
      return db.$transaction(async (tx) => {
        const existing = await tx.device.findFirst({ where: { id, storeId: actor.storeId }, select: { id: true, disabledAt: true } });
        if (!existing) throw new ApiError(404, "NOT_FOUND");
        const timestamp = new Date(now());
        if (!input.isActive || input.revokeSessions) {
          await tx.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: timestamp } });
        }
        const updated = await tx.device.update({
          where: { id },
          data: {
            name: input.name,
            disabledAt: input.isActive ? null : (existing.disabledAt ?? timestamp),
            ...((input.isActive || pinHash) && { approvalFails: 0, approvalUntil: null }),
            ...(pinHash && { pinHash }),
          },
          select: deviceSelect,
        });
        await audit(tx, actor, input.revokeSessions ? "DEVICE_SESSION_REVOKED" : "DEVICE_UPDATED", id);
        const referenced = await findReferencedDevices(tx, actor.storeId, [updated.id]);
        return deviceDto(updated, actor.deviceId, referenced.has(updated.id), +timestamp);
      });
    },
    async deleteDevice(actor: StoreActor, id: string) {
      if (id === actor.deviceId) throw new ApiError(403, "FORBIDDEN");
      return db.$transaction(async (tx) => {
        const existing = await tx.device.findFirst({ where: { id, storeId: actor.storeId }, select: deviceSelect });
        if (!existing) throw new ApiError(404, "NOT_FOUND");
        const session = existing.sessions[0];
        const hasActiveSession = !!session && session.expiresAt.getTime() > now();
        const referenced = await findReferencedDevices(tx, actor.storeId, [id]);
        if (hasActiveSession || referenced.has(id)) {
          throw new ApiError(409, "DEVICE_IN_USE");
        }
        try {
          await tx.heldSale.deleteMany({ where: { terminalId: id, storeId: actor.storeId } });
          await tx.session.deleteMany({ where: { deviceId: id } });
          await tx.device.delete({ where: { id } });
          await audit(tx, actor, "DEVICE_DELETED", id);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new ApiError(409, "DEVICE_IN_USE");
          }
          throw error;
        }
      });
    },
  };
}
