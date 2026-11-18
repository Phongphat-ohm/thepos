import type { Device, Prisma, PrismaClient, Session } from "@prisma/client";
import {
  capabilitySchema, foundationPermissionSchema, permissionSchema, roleSchema, tokenSchema,
  type Permission, type Profile,
} from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest, hashPassword, issueAccess, lockoutMs, newToken, readAccess, sessionMs, verifyPassword } from "../security";

type Db = Prisma.TransactionClient;
const roleIncludes = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;
const userIncludes = { ...roleIncludes, store: { select: { id: true, name: true } } } satisfies Prisma.UserInclude;
type Account = Prisma.UserGetPayload<{ include: typeof userIncludes }>;
type Options = { jwtSecret: string; now: () => number };
let dummyHash: Promise<string> | undefined;

const webBlockedPermissions = new Set<Permission>(["sales:checkout", "shift:operate"]);

function getDummyHash() {
  dummyHash ??= hashPassword(newToken());
  return dummyHash;
}

export function audit(
  tx: Db,
  actor: { storeId: string; userId?: string; deviceId?: string; deviceName?: string },
  event: string,
  reason?: string,
) {
  return tx.auditLog.create({
    data: {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      deviceName: actor.deviceName,
      event,
      reason,
    },
  });
}

function granted(user: Account, device?: { isWebDevice?: boolean }): Permission[] {
  const codes = user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code));
  const unique = [...new Set(codes)].filter((code): code is Permission => permissionSchema.safeParse(code).success);
  return device?.isWebDevice ? unique.filter((code) => !webBlockedPermissions.has(code)) : unique;
}

export function requirePermission(user: Account, permission: Permission, device?: { isWebDevice?: boolean }) {
  if (!granted(user, device).includes(permission)) throw new ApiError(403, "FORBIDDEN");
}

function profile(user: Account, device: Device): Profile {
  const permissions = granted(user, device);
  return {
    user: {
      id: user.id, username: user.username, name: user.name,
      roles: user.roles.map(({ role }) => roleSchema.parse(role.code)),
    },
    store: { id: user.store.id, name: user.store.name },
    device: { id: device.id, name: device.name, ...(device.isWebDevice && { isWebDevice: true }) },
    permissions: permissions.filter((code): code is (typeof foundationPermissionSchema.options)[number] =>
      foundationPermissionSchema.safeParse(code).success),
    capabilities: permissions.filter((code): code is (typeof capabilitySchema.options)[number] =>
      capabilitySchema.safeParse(code).success),
  };
}

export function deviceDigest(raw: string | undefined) {
  const token = tokenSchema.safeParse(raw);
  if (!token.success) throw new ApiError(401, "DEVICE_REQUIRED");
  return digest(token.data);
}

export async function registeredDevice(db: Db, raw: string | undefined) {
  const device = await db.device.findUnique({ where: { tokenHash: deviceDigest(raw) } });
  if (!device || device.disabledAt) throw new ApiError(401, "DEVICE_REQUIRED");
  return device;
}

async function lockAccount(tx: Db, id: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

export function nextFailure(count: number, previous: Date | null, now: number) {
  const failures = (previous ? 0 : count) + 1;
  return { failures, until: failures >= 5 ? new Date(now + lockoutMs) : null };
}

export async function withPassword<T>(
  db: PrismaClient,
  input: { username: string; password: string },
  now: () => number,
  event: string,
  action: (tx: Db, user: Account) => Promise<T>,
  device?: { id: string; name?: string },
): Promise<Exclude<T, ApiError>> {
  const candidate = await db.user.findUnique({ where: { username: input.username }, select: { id: true } });
  if (!candidate) {
    await verifyPassword(input.password, await getDummyHash());
    throw new ApiError(401, "INVALID_CREDENTIALS");
  }
  const result = await db.$transaction(async (tx) => {
    await lockAccount(tx, candidate.id);
    const user = await tx.user.findUnique({ where: { id: candidate.id }, include: userIncludes });
    if (!user || user.disabledAt) {
      await verifyPassword(input.password, await getDummyHash());
      return new ApiError(401, "INVALID_CREDENTIALS");
    }
    const timestamp = now();
    if (user.loginUntil && user.loginUntil.getTime() > timestamp) return new ApiError(429, "RATE_LIMITED");
    if (!await verifyPassword(input.password, user.passwordHash)) {
      const failure = nextFailure(user.loginFails, user.loginUntil, timestamp);
      await tx.user.update({
        where: { id: user.id },
        data: { loginFails: failure.failures, loginUntil: failure.until },
      });
      await audit(tx, { storeId: user.storeId, userId: user.id, deviceId: device?.id, deviceName: device?.name }, event, "INVALID_PASSWORD");
      return failure.until ? new ApiError(429, "RATE_LIMITED") : new ApiError(401, "INVALID_CREDENTIALS");
    }
    if (user.loginFails) {
      await tx.user.update({ where: { id: user.id }, data: { loginFails: 0, loginUntil: null } });
    }
    return action(tx, user);
  }, { timeout: 15_000 });
  if (result instanceof ApiError) throw result;
  return result as Exclude<T, ApiError>;
}

export function createAuth(db: PrismaClient, { jwtSecret, now }: Options) {
  const sessionIncludes = { user: { include: userIncludes }, device: true } as const;

  function validateSession(
    session: (Session & { user: Account; device: Device }) | null,
    device: Device,
    allowLocked = false,
  ) {
    if (!session || session.deviceId !== device.id || session.device.disabledAt
      || session.user.storeId !== device.storeId || session.user.disabledAt
      || session.revokedAt || session.expiresAt.getTime() <= now()) {
      throw new ApiError(401, "SESSION_REQUIRED");
    }

    if (!allowLocked && session.lockedAt) throw new ApiError(423, "SESSION_LOCKED");
    return session;
  }

  async function response(session: Session, user: Account, device: Device, refreshToken: string) {
    const accessToken = await issueAccess(session, jwtSecret, now());
    return { accessToken, refreshToken, profile: profile(user, device) };
  }

  async function withRefresh<T>(
    device: Device,
    raw: string | undefined,
    allowLocked: boolean,
    action: (tx: Db, session: Session & { user: Account; device: Device }) => Promise<T>,
  ): Promise<Exclude<T, ApiError>> {
    const token = tokenSchema.safeParse(raw);
    if (!token.success) throw new ApiError(401, "SESSION_REQUIRED");
    const refreshHash = digest(token.data);
    const result = await db.$transaction(async (tx) => {
      const candidate = await tx.session.findUnique({ where: { refreshHash }, select: { userId: true, deviceId: true } });
      if (!candidate || candidate.deviceId !== device.id) throw new ApiError(401, "SESSION_REQUIRED");
      await lockAccount(tx, candidate.userId);
      const row = await tx.session.findUnique({ where: { refreshHash }, include: sessionIncludes });
      return action(tx, validateSession(row, device, allowLocked));
    }, { timeout: 15_000 });
    if (result instanceof ApiError) throw result;
    return result as Exclude<T, ApiError>;
  }

  async function withAccess(authorization: string | undefined, device: Device, tx: Db = db) {
    const claims = await readAccess(authorization, jwtSecret, now());
    if (claims.did !== device.id) throw new ApiError(401, "SESSION_REQUIRED");
    const row = await tx.session.findUnique({ where: { id: claims.sid }, include: sessionIncludes });
    if (!row || row.userId !== claims.sub) throw new ApiError(401, "SESSION_REQUIRED");
    const session = validateSession(row, device);
    if (session.generation !== claims.gen) throw new ApiError(401, "SESSION_REQUIRED");
    requirePermission(session.user, "session:use", session.device);
    return session;
  }

  async function rotate(tx: Db, session: Session & { user: Account; device: Device }, unlock = false) {
    const refreshToken = newToken();
    const updated = await tx.session.update({
      where: { id: session.id },
      data: {
        refreshHash: digest(refreshToken), generation: { increment: 1 },
        ...(unlock && { lockedAt: null, pinFails: 0, pinUntil: null }),
      },
    });
    return response(updated, session.user, session.device, refreshToken);
  }

  const actor = (session: Session & { user: Account; device: Device }) =>
    ({ storeId: session.user.storeId, userId: session.userId, deviceId: session.deviceId, deviceName: session.device.name });

  return {
    login: (device: Device, input: { username: string; password: string }) =>
      withPassword(db, input, now, "LOGIN_FAILED", async (tx, user) => {
        if (user.storeId !== device.storeId || device.isWebDevice) throw new ApiError(403, "FORBIDDEN");
        requirePermission(user, "session:use", device);
        const refreshToken = newToken();
        const timestamp = new Date(now());
        await tx.session.updateMany({ where: { userId: user.id, deviceId: device.id, revokedAt: null }, data: { revokedAt: timestamp } });
        const session = await tx.session.create({
          data: { userId: user.id, deviceId: device.id, refreshHash: digest(refreshToken), expiresAt: new Date(+timestamp + sessionMs) },
        });
        await audit(tx, actor({ ...session, user, device }), "LOGIN");
        return response(session, user, device, refreshToken);
      }, device),

    webLogin: (input: { username: string; password: string }, rawDeviceToken?: string) =>
      withPassword(db, input, now, "LOGIN_FAILED", async (tx, user) => {
        requirePermission(user, "session:use", { isWebDevice: true });
        const parsedBrowserToken = tokenSchema.safeParse(rawDeviceToken);
        let deviceToken: string;
        let device: Device | null = null;
        if (parsedBrowserToken.success) {
          const existing = await tx.device.findUnique({ where: { tokenHash: digest(parsedBrowserToken.data) } });
          if (existing && existing.storeId === user.storeId && existing.isWebDevice) {
            if (existing.disabledAt) throw new ApiError(403, "FORBIDDEN");
            device = existing;
            deviceToken = parsedBrowserToken.data;
          } else {
            deviceToken = newToken();
          }
        } else {
          deviceToken = newToken();
        }
        if (!device) {
          device = await tx.device.create({
            data: { storeId: user.storeId, name: "เว็บเบราว์เซอร์", tokenHash: digest(deviceToken), isWebDevice: true },
          });
        }
        const refreshToken = newToken();
        const timestamp = new Date(now());
        await tx.session.updateMany({ where: { userId: user.id, deviceId: device.id, revokedAt: null }, data: { revokedAt: timestamp } });
        const session = await tx.session.create({
          data: { userId: user.id, deviceId: device.id, refreshHash: digest(refreshToken), expiresAt: new Date(+timestamp + sessionMs) },
        });
        await audit(tx, actor({ ...session, user, device }), "LOGIN");
        return { ...(await response(session, user, device, refreshToken)), deviceToken };
      }),

    refresh: (device: Device, token: string | undefined) =>
      withRefresh(device, token, false, (tx, session) => {
        requirePermission(session.user, "session:use", session.device);
        return rotate(tx, session);
      }),

    lock: (device: Device, token: string | undefined) =>
      withRefresh(device, token, true, async (tx, session) => {
        if (!session.lockedAt) {
          await tx.session.update({ where: { id: session.id }, data: { lockedAt: new Date(now()), generation: { increment: 1 } } });
          await audit(tx, actor(session), "LOCK");
        }
        return { userName: session.user.name };
      }),

    unlock: (device: Device, token: string | undefined, pin: string) =>
      withRefresh(device, token, true, async (tx, session) => {
        requirePermission(session.user, "session:use", session.device);
        if (!session.lockedAt) throw new ApiError(409, "SESSION_REQUIRED");
        const timestamp = now();
        if (session.pinUntil && +session.pinUntil > timestamp) return new ApiError(429, "RATE_LIMITED");
        if (!await verifyPassword(pin, session.user.pinHash)) {
          const failure = nextFailure(session.pinFails, session.pinUntil, timestamp);
          await tx.session.update({ where: { id: session.id }, data: { pinFails: failure.failures, pinUntil: failure.until } });
          await audit(tx, actor(session), "UNLOCK_FAILED", "INVALID_PIN");
          return failure.until ? new ApiError(429, "RATE_LIMITED") : new ApiError(401, "INVALID_PIN");
        }
        await audit(tx, actor(session), "UNLOCK");
        return rotate(tx, session, true);
      }),

    logout: (device: Device, token: string | undefined) =>
      withRefresh(device, token, true, async (tx, session) => {
        await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date(now()) } });
        await audit(tx, actor(session), "LOGOUT");
      }),

    me: async (authorization: string | undefined, device: Device) => {
      const session = await withAccess(authorization, device);
      return profile(session.user, session.device);
    },

    authorize: async (authorization: string | undefined, device: Device, permission: Permission) => {
      const session = await withAccess(authorization, device);
      requirePermission(session.user, permission, session.device);
      return actor(session);
    },

    authorizeAny: async (authorization: string | undefined, device: Device, required: readonly Permission[]) => {
      const session = await withAccess(authorization, device);
      const capabilities = granted(session.user, session.device);
      if (!required.some((permission) => capabilities.includes(permission))) {
        throw new ApiError(403, "FORBIDDEN");
      }
      return { actor: actor(session), capabilities };
    },

    changePassword: async (
      authorization: string | undefined,
      device: Device,
      input: { currentPassword: string; newPassword: string },
    ) => {
      const session = await withAccess(authorization, device);
      return withPassword(db, { username: session.user.username, password: input.currentPassword }, now,
        "PASSWORD_CHANGE_FAILED", async (tx, user) => {
          await withAccess(authorization, device, tx);
          const newPasswordHash = await hashPassword(input.newPassword);
          await tx.user.update({ where: { id: user.id }, data: { passwordHash: newPasswordHash } });
          await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(now()) } });
          await audit(tx, actor(session), "PASSWORD_CHANGED");
        }, device);
    },
  };
}
