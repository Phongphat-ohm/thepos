import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CountSessionCreateInput,
  CountSessionEntryCreateInput,
  CountSessionEntryUpdateInput,
  CountSessionFinalizeInput,
  CountSessionQuery,
  CountSessionStatusInput,
  MobileJoinInput,
} from "@thepos/contracts";
import { audit, type StoreActor } from "../../core/audit";
import { ApiError } from "../../core/errors";
import { pageMeta, resolveOrder } from "../../core/pagination";
import { digest, newToken } from "../../core/security";
import { lockProducts } from "../catalog/service";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

export function formatJoinCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function parseUnitMultiplier(
  product: { baseUnit: string; units: { name: string; multiplier: Prisma.Decimal }[] },
  unitName: string,
): Prisma.Decimal {
  if (unitName === product.baseUnit) return new Prisma.Decimal(1);
  const found = product.units.find((u) => u.name === unitName);
  if (!found) throw new ApiError(400, "INVALID_QUANTITY");
  return found.multiplier;
}

function toBaseQuantity(inputQty: string, multiplier: Prisma.Decimal): Prisma.Decimal {
  const qty = new Prisma.Decimal(inputQty);
  if (qty.lte(0)) throw new ApiError(400, "INVALID_QUANTITY");
  const base = qty.mul(multiplier);
  if (base.decimalPlaces() > 3 || base.gt(new Prisma.Decimal("999999999.999"))) {
    throw new ApiError(400, "INVALID_QUANTITY");
  }
  return base;
}

async function lockLots(tx: Prisma.TransactionClient, storeId: string, ids: string[]) {
  const scope = { id: { in: ids }, product: { storeId } };
  const links = await tx.stockLot.findMany({ where: scope, select: { productId: true } });
  if (links.length !== ids.length) throw new ApiError(400, "INVALID_REFERENCE");
  await lockProducts(tx, storeId, [...new Set(links.map(({ productId }) => productId))]);
  const values = Prisma.join(ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
  await tx.$queryRaw`SELECT id FROM stock_lots WHERE id IN (${values}) ORDER BY id FOR UPDATE`;
  return new Map((await tx.stockLot.findMany({ where: scope })).map((lot) => [lot.id, lot]));
}

const entryInclude = {
  lot: { include: { product: { include: { units: true } } } },
  participant: { select: { id: true, displayName: true } },
  editedByUser: { select: { id: true, name: true } },
} satisfies Prisma.StockCountEntryInclude;

function entryDto(entry: Prisma.StockCountEntryGetPayload<{ include: typeof entryInclude }>) {
  return {
    id: entry.id,
    lotId: entry.lotId,
    lotNumber: entry.lot.lotNumber,
    expirationDate: entry.lot.expirationDate?.toISOString().slice(0, 10) ?? null,
    productId: entry.lot.product.id,
    sku: entry.lot.product.sku,
    productName: entry.lot.product.name,
    baseUnit: entry.lot.product.baseUnit,
    unitName: entry.unitName,
    unitMultiplier: entry.unitMultiplier.toFixed(3),
    inputQuantity: entry.inputQuantity.toFixed(3),
    baseQuantity: entry.baseQuantity.toFixed(3),
    note: entry.note,
    participantId: entry.participant?.id ?? null,
    participantName: entry.participant?.displayName ?? null,
    editedByName: entry.editedByUser?.name ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export type NetworkUrlsInfo = {
  preferredMobileBaseUrl: string | null;
  mobileBaseUrls: string[];
  httpsEnabled: boolean;
};

export function createMobileStockCounts(
  db: PrismaClient,
  now: () => number = Date.now,
  getNetworkUrls?: () => NetworkUrlsInfo,
) {
  async function resolveParticipant(rawToken: string | undefined, requireOpen: boolean) {
    if (!rawToken || rawToken.length < 16 || rawToken.length > 256) {
      throw new ApiError(401, "SESSION_REQUIRED");
    }
    const tokenHash = digest(rawToken);
    const participant = await db.stockCountParticipant.findUnique({
      where: { tokenHash },
      include: {
        session: {
          include: {
            store: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!participant) throw new ApiError(401, "SESSION_REQUIRED");
    if (participant.revokedAt) throw new ApiError(401, "PARTICIPANT_REVOKED");

    const { session } = participant;
    if (requireOpen) {
      if (session.status === "PAUSED") throw new ApiError(409, "COUNT_SESSION_PAUSED");
      if (session.status !== "OPEN") throw new ApiError(409, "COUNT_SESSION_CLOSED");
    }

    const current = now();
    if (current - participant.lastSeenAt.getTime() > 15_000) {
      void db.stockCountParticipant
        .update({ where: { id: participant.id }, data: { lastSeenAt: new Date(current) } })
        .catch(() => {});
    }

    return participant;
  }

  return {
    async listSessions(storeId: string, query: CountSessionQuery) {
      const { q, status, limit, after, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.StockCountSessionWhereInput = {
        storeId,
        ...(status && status !== "all" && { status }),
        ...(q && {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { reason: { contains: q, mode: "insensitive" } },
            { joinCode: { contains: q.toUpperCase().replace(/[^A-Z0-9]/g, "") } },
          ],
        }),
      };
      const orderBy = resolveOrder<Prisma.StockCountSessionOrderByWithRelationInput>(
        {
          createdAt: (dir) => [{ createdAt: dir }, { id: dir }],
          status: (dir) => [{ status: dir }, { createdAt: "desc" }],
        },
        [{ createdAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      const include = {
        createdBy: { select: { name: true } },
        _count: { select: { participants: true, entries: true } },
      } satisfies Prisma.StockCountSessionInclude;

      const mapRow = async (rows: Prisma.StockCountSessionGetPayload<{ include: typeof include }>[]) => {
        const sessionIds = rows.map((r) => r.id);
        const lotGroups = sessionIds.length
          ? await db.stockCountEntry.groupBy({
              by: ["sessionId", "lotId"],
              where: { sessionId: { in: sessionIds } },
            })
          : [];
        const lotCounts = new Map<string, number>();
        for (const group of lotGroups) {
          lotCounts.set(group.sessionId, (lotCounts.get(group.sessionId) ?? 0) + 1);
        }
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          reason: row.reason,
          status: row.status,
          joinCode: formatJoinCode(row.joinCode),
          rawJoinCode: row.joinCode,
          showExpectedQty: row.showExpectedQty,
          stockCountId: row.stockCountId,
          createdBy: row.createdBy.name,
          participantCount: row._count.participants,
          entryCount: row._count.entries,
          lotCount: lotCounts.get(row.id) ?? 0,
          createdAt: row.createdAt.toISOString(),
          pausedAt: row.pausedAt?.toISOString() ?? null,
          closedAt: row.closedAt?.toISOString() ?? null,
        }));
      };

      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.stockCountSession.findMany({ where, include, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.stockCountSession.count({ where }),
        ]);
        return { items: await mapRow(rows), ...pageMeta(total, pageNum, limit) };
      }

      const rows = await db.stockCountSession.findMany({
        where,
        include,
        orderBy,
        take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      const sliced = rows.slice(0, limit);
      return {
        items: await mapRow(sliced),
        nextCursor: rows.length > limit ? sliced[sliced.length - 1]!.id : null,
      };
    },

    async createSession(actor: StoreActor, input: CountSessionCreateInput) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const joinCode = generateJoinCode();
        try {
          const session = await db.$transaction(async (tx) => {
            const created = await tx.stockCountSession.create({
              data: {
                storeId: actor.storeId,
                createdById: actor.userId,
                title: input.title,
                reason: input.reason,
                showExpectedQty: input.showExpectedQty,
                joinCode,
                status: "OPEN",
              },
              include: { createdBy: { select: { name: true } } },
            });
            await audit(tx, actor, "STOCK_COUNT_SESSION_CREATED", created.id);
            return created;
          });
          return {
            id: session.id,
            title: session.title,
            reason: session.reason,
            status: session.status,
            joinCode: formatJoinCode(session.joinCode),
            rawJoinCode: session.joinCode,
            showExpectedQty: session.showExpectedQty,
            stockCountId: session.stockCountId,
            createdBy: session.createdBy.name,
            createdAt: session.createdAt.toISOString(),
          };
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 4) {
            continue;
          }
          throw error;
        }
      }
      throw new ApiError(503, "UNAVAILABLE");
    },

    async getSessionDetail(storeId: string, sessionId: string) {
      const session = await db.stockCountSession.findFirst({
        where: { id: sessionId, storeId },
        include: {
          createdBy: { select: { name: true } },
          participants: {
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { entries: true } } },
          },
          entries: {
            orderBy: { createdAt: "desc" },
            include: entryInclude,
          },
        },
      });
      if (!session) throw new ApiError(404, "NOT_FOUND");

      const lotIds = [...new Set(session.entries.map((e) => e.lotId))];
      const movements = lotIds.length
        ? await db.stockMovement.findMany({
            where: {
              lotId: { in: lotIds },
              createdAt: { gte: session.createdAt },
            },
            select: { lotId: true, kind: true, quantity: true },
          })
        : [];

      const movementByLot = new Map<string, { count: number; netDelta: Prisma.Decimal; kinds: Set<string> }>();
      for (const mv of movements) {
        const existing = movementByLot.get(mv.lotId) ?? { count: 0, netDelta: new Prisma.Decimal(0), kinds: new Set<string>() };
        existing.count += 1;
        existing.netDelta = existing.netDelta.plus(mv.quantity);
        existing.kinds.add(mv.kind);
        movementByLot.set(mv.lotId, existing);
      }

      const summaryMap = new Map<
        string,
        {
          lotId: string;
          lotNumber: string;
          expirationDate: string | null;
          productId: string;
          sku: string;
          productName: string;
          baseUnit: string;
          expected: Prisma.Decimal;
          counted: Prisma.Decimal;
          entryCount: number;
          lastCountedAt: Date;
        }
      >();

      for (const entry of session.entries) {
        const existing = summaryMap.get(entry.lotId);
        if (!existing) {
          summaryMap.set(entry.lotId, {
            lotId: entry.lotId,
            lotNumber: entry.lot.lotNumber,
            expirationDate: entry.lot.expirationDate?.toISOString().slice(0, 10) ?? null,
            productId: entry.lot.product.id,
            sku: entry.lot.product.sku,
            productName: entry.lot.product.name,
            baseUnit: entry.lot.product.baseUnit,
            expected: entry.lot.remainingQuantity,
            counted: entry.baseQuantity,
            entryCount: 1,
            lastCountedAt: entry.createdAt,
          });
        } else {
          existing.counted = existing.counted.plus(entry.baseQuantity);
          existing.entryCount += 1;
          if (entry.createdAt > existing.lastCountedAt) existing.lastCountedAt = entry.createdAt;
        }
      }

      const summary = [...summaryMap.values()]
        .sort((a, b) => a.sku.localeCompare(b.sku) || a.lotNumber.localeCompare(b.lotNumber))
        .map((row) => {
          const mv = movementByLot.get(row.lotId);
          return {
            lotId: row.lotId,
            lotNumber: row.lotNumber,
            expirationDate: row.expirationDate,
            productId: row.productId,
            sku: row.sku,
            productName: row.productName,
            baseUnit: row.baseUnit,
            expected: row.expected.toFixed(3),
            counted: row.counted.toFixed(3),
            variance: row.counted.minus(row.expected).toFixed(3),
            entryCount: row.entryCount,
            lastCountedAt: row.lastCountedAt.toISOString(),
            movementSinceStart: mv
              ? {
                  count: mv.count,
                  netDelta: mv.netDelta.toFixed(3),
                  kinds: [...mv.kinds],
                }
              : null,
          };
        });

      const network = getNetworkUrls?.() ?? {
        preferredMobileBaseUrl: null,
        mobileBaseUrls: [],
        httpsEnabled: false,
      };

      return {
        id: session.id,
        title: session.title,
        reason: session.reason,
        status: session.status,
        joinCode: formatJoinCode(session.joinCode),
        rawJoinCode: session.joinCode,
        showExpectedQty: session.showExpectedQty,
        stockCountId: session.stockCountId,
        createdBy: session.createdBy.name,
        createdAt: session.createdAt.toISOString(),
        pausedAt: session.pausedAt?.toISOString() ?? null,
        closedAt: session.closedAt?.toISOString() ?? null,
        preferredMobileBaseUrl: network.preferredMobileBaseUrl,
        mobileBaseUrls: network.mobileBaseUrls,
        httpsEnabled: network.httpsEnabled,
        participants: session.participants.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          clientIp: p.clientIp,
          entryCount: p._count.entries,
          revokedAt: p.revokedAt?.toISOString() ?? null,
          lastSeenAt: p.lastSeenAt.toISOString(),
          createdAt: p.createdAt.toISOString(),
        })),
        summary,
        entries: session.entries.map(entryDto),
      };
    },

    async setSessionStatus(actor: StoreActor, sessionId: string, { status }: CountSessionStatusInput) {
      return db.$transaction(async (tx) => {
        const session = await tx.stockCountSession.findFirst({
          where: { id: sessionId, storeId: actor.storeId },
        });
        if (!session) throw new ApiError(404, "NOT_FOUND");
        if (session.status === "SUBMITTED" || session.status === "CANCELLED") {
          throw new ApiError(409, "COUNT_SESSION_CLOSED");
        }
        const timestamp = new Date(now());
        const updated = await tx.stockCountSession.update({
          where: { id: session.id },
          data: {
            status,
            pausedAt: status === "PAUSED" ? timestamp : status === "OPEN" ? null : session.pausedAt,
            closedAt: status === "CANCELLED" ? timestamp : null,
          },
        });
        await audit(tx, actor, `STOCK_COUNT_SESSION_${status}`, session.id);
        return {
          id: updated.id,
          status: updated.status,
          pausedAt: updated.pausedAt?.toISOString() ?? null,
          closedAt: updated.closedAt?.toISOString() ?? null,
        };
      });
    },

    async revokeParticipant(actor: StoreActor, sessionId: string, participantId: string) {
      return db.$transaction(async (tx) => {
        const participant = await tx.stockCountParticipant.findFirst({
          where: { id: participantId, sessionId, session: { storeId: actor.storeId } },
        });
        if (!participant) throw new ApiError(404, "NOT_FOUND");
        if (participant.revokedAt) {
          return { id: participant.id, revokedAt: participant.revokedAt.toISOString() };
        }
        const updated = await tx.stockCountParticipant.update({
          where: { id: participant.id },
          data: { revokedAt: new Date(now()) },
        });
        await audit(tx, actor, "STOCK_COUNT_PARTICIPANT_REVOKED", `${sessionId}:${participant.id}`);
        return { id: updated.id, revokedAt: updated.revokedAt!.toISOString() };
      });
    },

    async updateDesktopEntry(actor: StoreActor, sessionId: string, entryId: string, input: CountSessionEntryUpdateInput) {
      return db.$transaction(async (tx) => {
        const entry = await tx.stockCountEntry.findFirst({
          where: { id: entryId, sessionId, session: { storeId: actor.storeId } },
          include: {
            session: true,
            lot: { include: { product: { include: { units: true } } } },
          },
        });
        if (!entry) throw new ApiError(404, "NOT_FOUND");
        if (entry.session.status === "SUBMITTED" || entry.session.status === "CANCELLED") {
          throw new ApiError(409, "COUNT_SESSION_CLOSED");
        }
        const unitName = input.unit ?? entry.unitName;
        const multiplier = parseUnitMultiplier(entry.lot.product, unitName);
        const baseQuantity = toBaseQuantity(input.quantity, multiplier);

        const updated = await tx.stockCountEntry.update({
          where: { id: entry.id },
          data: {
            unitName,
            unitMultiplier: multiplier,
            inputQuantity: new Prisma.Decimal(input.quantity),
            baseQuantity,
            note: input.note,
            editedByUserId: actor.userId,
          },
          include: entryInclude,
        });
        return entryDto(updated);
      });
    },

    async deleteDesktopEntry(actor: StoreActor, sessionId: string, entryId: string) {
      return db.$transaction(async (tx) => {
        const entry = await tx.stockCountEntry.findFirst({
          where: { id: entryId, sessionId, session: { storeId: actor.storeId } },
          include: { session: true },
        });
        if (!entry) throw new ApiError(404, "NOT_FOUND");
        if (entry.session.status === "SUBMITTED" || entry.session.status === "CANCELLED") {
          throw new ApiError(409, "COUNT_SESSION_CLOSED");
        }
        await tx.stockCountEntry.delete({ where: { id: entry.id } });
        return { deleted: true, id: entry.id };
      });
    },

    async finalizeSession(actor: StoreActor, sessionId: string, key: string, input: CountSessionFinalizeInput) {
      const payloadHash = digest(JSON.stringify({ sessionId, ...input }));
      const countWhere = { storeId_idempotencyKey: { storeId: actor.storeId, idempotencyKey: key } };

      return db.$transaction(async (tx) => {
        const selected = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM stock_count_sessions
          WHERE store_id = CAST(${actor.storeId} AS uuid) AND id = CAST(${sessionId} AS uuid)
          FOR UPDATE
        `;
        if (!selected.length) throw new ApiError(404, "NOT_FOUND");

        const session = await tx.stockCountSession.findUniqueOrThrow({ where: { id: sessionId } });
        const previous = await tx.stockCount.findUnique({ where: countWhere });
        if (previous) {
          if (previous.payloadHash !== payloadHash || previous.submittedById !== actor.userId) {
            throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          }
          return { sessionId: session.id, stockCountId: previous.id, status: "SUBMITTED" as const };
        }

        if (session.status === "SUBMITTED" || session.status === "CANCELLED") {
          throw new ApiError(409, "COUNT_SESSION_CLOSED");
        }

        const lots = await lockLots(tx, actor.storeId, input.lines.map(({ lotId }) => lotId));
        const adjustments = input.lines.map(({ lotId, expected, counted }) => {
          const lot = lots.get(lotId);
          if (!lot?.remainingQuantity.eq(expected)) throw new ApiError(409, "STOCK_COUNT_STALE");
          return { lotId, expectedQuantity: lot.remainingQuantity, countedQuantity: counted };
        });

        const count = await tx.stockCount.create({
          data: {
            ...countWhere.storeId_idempotencyKey,
            payloadHash,
            submittedById: actor.userId,
            reason: input.reason ?? session.reason,
            adjustments: { create: adjustments },
          },
        });

        await tx.stockCountSession.update({
          where: { id: session.id },
          data: {
            status: "SUBMITTED",
            closedAt: new Date(now()),
            stockCountId: count.id,
          },
        });

        await audit(tx, actor, "STOCK_COUNT_SUBMITTED", count.id);
        await audit(tx, actor, "STOCK_COUNT_SESSION_SUBMITTED", `${session.id}:${count.id}`);

        return { sessionId: session.id, stockCountId: count.id, status: "SUBMITTED" as const };
      }, { timeout: 30_000 });
    },

    // --- Mobile Participant Endpoints (No POS login, LAN-only) ---

    async joinMobile(input: MobileJoinInput, clientIp: string | undefined, userAgent: string | undefined) {
      const session = await db.stockCountSession.findUnique({
        where: { joinCode: input.code },
        include: { store: { select: { name: true } } },
      });
      if (!session) throw new ApiError(404, "NOT_FOUND");
      if (session.status === "SUBMITTED" || session.status === "CANCELLED") {
        throw new ApiError(409, "COUNT_SESSION_CLOSED");
      }

      const token = newToken();
      const participant = await db.stockCountParticipant.create({
        data: {
          sessionId: session.id,
          displayName: input.displayName,
          tokenHash: digest(token),
          clientIp: clientIp?.slice(0, 64) ?? null,
          userAgent: userAgent?.slice(0, 255) ?? null,
          lastSeenAt: new Date(now()),
        },
      });

      return {
        token,
        participant: {
          id: participant.id,
          displayName: participant.displayName,
        },
        session: {
          id: session.id,
          title: session.title,
          status: session.status,
          showExpectedQty: session.showExpectedQty,
          storeName: session.store.name,
        },
      };
    },

    async getMobileState(rawToken: string | undefined) {
      const participant = await resolveParticipant(rawToken, false);
      const entries = await db.stockCountEntry.findMany({
        where: { sessionId: participant.sessionId, participantId: participant.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: entryInclude,
      });
      const totalEntries = await db.stockCountEntry.count({
        where: { sessionId: participant.sessionId, participantId: participant.id },
      });

      return {
        participant: {
          id: participant.id,
          displayName: participant.displayName,
        },
        session: {
          id: participant.session.id,
          title: participant.session.title,
          status: participant.session.status,
          showExpectedQty: participant.session.showExpectedQty,
          storeName: participant.session.store.name,
        },
        totalEntries,
        entries: entries.map(entryDto),
      };
    },

    async lookupMobileProducts(rawToken: string | undefined, q: string) {
      const participant = await resolveParticipant(rawToken, false);
      const { session } = participant;
      const term = q.trim();

      const include = {
        barcodes: { select: { code: true } },
        units: { orderBy: { name: "asc" as const } },
        lots: {
          orderBy: [{ expirationDate: "asc" as const }, { receivedAt: "asc" as const }],
        },
      } satisfies Prisma.ProductInclude;

      let products = await db.product.findMany({
        where: {
          storeId: session.storeId,
          isActive: true,
          trackStock: true,
          barcodes: { some: { code: term } },
        },
        include,
        take: 10,
      });

      const exactBarcode = products.length > 0;
      if (!exactBarcode) {
        products = await db.product.findMany({
          where: {
            storeId: session.storeId,
            isActive: true,
            trackStock: true,
            OR: [
              { sku: { equals: term.toUpperCase() } },
              { sku: { contains: term, mode: "insensitive" } },
              { name: { contains: term, mode: "insensitive" } },
              { barcodes: { some: { code: { contains: term, mode: "insensitive" } } } },
            ],
          },
          include,
          orderBy: { name: "asc" },
          take: 15,
        });
      }

      const allLotIds = products.flatMap((p) => p.lots.map((l) => l.id));
      const existingEntries = allLotIds.length
        ? await db.stockCountEntry.findMany({
            where: { sessionId: session.id, lotId: { in: allLotIds } },
            select: { lotId: true, participantId: true, baseQuantity: true },
          })
        : [];

      const sessionTotalByLot = new Map<string, Prisma.Decimal>();
      const myTotalByLot = new Map<string, Prisma.Decimal>();
      for (const e of existingEntries) {
        sessionTotalByLot.set(e.lotId, (sessionTotalByLot.get(e.lotId) ?? new Prisma.Decimal(0)).plus(e.baseQuantity));
        if (e.participantId === participant.id) {
          myTotalByLot.set(e.lotId, (myTotalByLot.get(e.lotId) ?? new Prisma.Decimal(0)).plus(e.baseQuantity));
        }
      }

      return {
        exactBarcode,
        items: products.map((product) => {
          const positiveLots = product.lots.filter((l) => l.remainingQuantity.gt(0));
          const visibleLots = positiveLots.length > 0 ? positiveLots : product.lots.slice(-5);
          return {
            id: product.id,
            sku: product.sku,
            name: product.name,
            baseUnit: product.baseUnit,
            trackExpiration: product.trackExpiration,
            barcodes: product.barcodes.map((b) => b.code),
            units: [
              { name: product.baseUnit, multiplier: "1.000" },
              ...product.units.map((u) => ({ name: u.name, multiplier: u.multiplier.toFixed(3) })),
            ],
            lots: visibleLots.map((lot) => ({
              id: lot.id,
              lotNumber: lot.lotNumber,
              expirationDate: lot.expirationDate?.toISOString().slice(0, 10) ?? null,
              receivedAt: lot.receivedAt.toISOString(),
              ...(session.showExpectedQty ? { expectedQuantity: lot.remainingQuantity.toFixed(3) } : {}),
              myCounted: (myTotalByLot.get(lot.id) ?? new Prisma.Decimal(0)).toFixed(3),
              sessionCounted: (sessionTotalByLot.get(lot.id) ?? new Prisma.Decimal(0)).toFixed(3),
            })),
          };
        }),
      };
    },

    async addMobileEntry(rawToken: string | undefined, input: CountSessionEntryCreateInput) {
      const participant = await resolveParticipant(rawToken, true);
      const { session } = participant;

      const lot = await db.stockLot.findFirst({
        where: { id: input.lotId, product: { storeId: session.storeId, trackStock: true } },
        include: { product: { include: { units: true } } },
      });
      if (!lot) throw new ApiError(400, "INVALID_REFERENCE");

      const multiplier = parseUnitMultiplier(lot.product, input.unit);
      const baseQuantity = toBaseQuantity(input.quantity, multiplier);

      const created = await db.stockCountEntry.create({
        data: {
          sessionId: session.id,
          lotId: lot.id,
          participantId: participant.id,
          unitName: input.unit,
          unitMultiplier: multiplier,
          inputQuantity: new Prisma.Decimal(input.quantity),
          baseQuantity,
          note: input.note,
        },
        include: entryInclude,
      });

      const aggregate = await db.stockCountEntry.aggregate({
        where: { sessionId: session.id, lotId: lot.id },
        _sum: { baseQuantity: true },
      });

      return {
        entry: entryDto(created),
        sessionLotTotal: (aggregate._sum.baseQuantity ?? new Prisma.Decimal(0)).toFixed(3),
      };
    },

    async updateMobileEntry(rawToken: string | undefined, entryId: string, input: CountSessionEntryUpdateInput) {
      const participant = await resolveParticipant(rawToken, true);
      const existing = await db.stockCountEntry.findFirst({
        where: { id: entryId, sessionId: participant.sessionId, participantId: participant.id },
        include: { lot: { include: { product: { include: { units: true } } } } },
      });
      if (!existing) throw new ApiError(404, "NOT_FOUND");

      const unitName = input.unit ?? existing.unitName;
      const multiplier = parseUnitMultiplier(existing.lot.product, unitName);
      const baseQuantity = toBaseQuantity(input.quantity, multiplier);

      const updated = await db.stockCountEntry.update({
        where: { id: existing.id },
        data: {
          unitName,
          unitMultiplier: multiplier,
          inputQuantity: new Prisma.Decimal(input.quantity),
          baseQuantity,
          note: input.note,
        },
        include: entryInclude,
      });

      return { entry: entryDto(updated) };
    },

    async deleteMobileEntry(rawToken: string | undefined, entryId: string) {
      const participant = await resolveParticipant(rawToken, true);
      const existing = await db.stockCountEntry.findFirst({
        where: { id: entryId, sessionId: participant.sessionId, participantId: participant.id },
      });
      if (!existing) throw new ApiError(404, "NOT_FOUND");

      await db.stockCountEntry.delete({ where: { id: existing.id } });
      return { deleted: true, id: existing.id };
    },
  };
}
