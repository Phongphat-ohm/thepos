import type { HeldSale, Prisma, PrismaClient } from "@prisma/client";
import { heldInput, type HeldInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { translateDuplicate, type StoreActor } from "./catalog";
import { memberSearch } from "./members";
import { pageMeta, resolveOrder } from "./pagination";

export const productSelection = {
  id: true, sku: true, name: true, baseUnit: true, regularPrice: true, memberPrice: true,
  units: { select: { name: true, multiplier: true }, orderBy: { name: "asc" as const } },
} satisfies Prisma.ProductSelect;

export function productForRegister(item: Prisma.ProductGetPayload<{ select: typeof productSelection }>) {
  return {
    ...item, regularPrice: item.regularPrice.toFixed(2), memberPrice: item.memberPrice.toFixed(2),
    units: item.units.map(({ name, multiplier }) => ({ name, multiplier: multiplier.toFixed(3) })),
  };
}

const memberSelection = { id: true, number: true, name: true };
const owner = (actor: StoreActor) => ({ cashierId: actor.userId, terminalId: actor.deviceId });
const ownedBy = (row: HeldSale, actor: StoreActor) => row.cashierId === actor.userId && row.terminalId === actor.deviceId;

function dto(row: HeldSale) {
  const draft = heldInput.parse(row.payload);
  return {
    id: row.id, revision: row.revision, held: row.held, note: row.note,
    updatedAt: row.updatedAt.toISOString(), draft,
  };
}

async function readLocked(tx: Prisma.TransactionClient, storeId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM held_sales WHERE store_id = CAST(${storeId} AS uuid) AND id = CAST(${id} AS uuid) FOR UPDATE`;
  return tx.heldSale.findFirst({ where: { id, storeId } });
}

export async function consumeHeld(
  tx: Prisma.TransactionClient, actor: StoreActor, hold: { id: string; revision: number },
) {
  const row = await readLocked(tx, actor.storeId, hold.id);
  if (!row || row.consumed || row.held || !ownedBy(row, actor) || row.revision !== hold.revision) {
    throw new ApiError(409, "HELD_CONFLICT");
  }
  await tx.heldSale.update({ where: { id: row.id }, data: { consumed: true, revision: { increment: 1 } } });
}

export function createPOSDrafts(db: PrismaClient) {
  return {
    async members(storeId: string, q: string) {
      if (q) {
        const exact = await db.member.findMany({
          where: { storeId, isActive: true, OR: [{ barcode: q }, { phone: q }, { number: q.toUpperCase() }] },
          select: memberSelection, orderBy: { number: "asc" }, take: 50,
        });
        if (exact.length) return { items: exact };
      }
      const items = await db.member.findMany({
        where: { storeId, isActive: true, ...memberSearch(q) },
        select: memberSelection,
        orderBy: { number: "asc" },
        take: 50,
      });
      return { items };
    },
    async list(actor: StoreActor, query: { q?: string; limit: number; after?: string; page?: number; sortBy?: string; sortDir?: "asc" | "desc" }) {
      const { q, limit, after, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.HeldSaleWhereInput = {
        storeId: actor.storeId, consumed: false, OR: [{ held: true }, owner(actor)],
        ...(q && { note: { contains: q, mode: "insensitive" } }),
      };
      const orderBy = resolveOrder<Prisma.HeldSaleOrderByWithRelationInput>(
        {
          note: (dir) => [{ note: dir }, { updatedAt: "desc" }],
          updatedAt: (dir) => [{ updatedAt: dir }, { id: dir }],
        },
        [{ updatedAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.heldSale.findMany({ where, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.heldSale.count({ where }),
        ]);
        return { items: rows.map(dto), ...pageMeta(total, pageNum, limit) };
      }
      const rows = await db.heldSale.findMany({
        where, orderBy, take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return {
        items: rows.slice(0, limit).map(dto),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    async hold(actor: StoreActor, id: string, input: HeldInput) {
      const { revision, ...payload } = input;
      return db.$transaction(async (tx) => {
        const lockKey = "hold/" + actor.storeId + "/" + id.toLowerCase();
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const row = await readLocked(tx, actor.storeId, id);
        if (row?.held && ownedBy(row, actor) && row.revision === (revision ?? 0) + 1
          && JSON.stringify(heldInput.parse(row.payload)) === JSON.stringify(heldInput.parse(payload))) return dto(row);
        if ((row && (row.held || row.consumed || !ownedBy(row, actor) || revision !== row.revision))
          || (!row && revision !== undefined)) throw new ApiError(409, "HELD_CONFLICT");
        const distinct = [...new Set(payload.lines.map(({ productId }) => productId.toLowerCase()))];
        const count = await tx.product.count({ where: { storeId: actor.storeId, id: { in: distinct } } });
        if (count !== distinct.length) throw new ApiError(400, "INVALID_REFERENCE");
        if (payload.memberId && !await tx.member.findFirst({ where: { storeId: actor.storeId, id: payload.memberId, isActive: true } })) {
          throw new ApiError(400, "INVALID_REFERENCE");
        }
        return dto(row
          ? await tx.heldSale.update({
            where: { id }, data: { held: true, payload, note: payload.note, revision: { increment: 1 } },
          })
          : await tx.heldSale.create({ data: { id, storeId: actor.storeId, ...owner(actor), payload, note: payload.note } }));
      }).catch(translateDuplicate);
    },
    async resume(actor: StoreActor, id: string, revision: number) {
      return db.$transaction(async (tx) => {
        const row = await readLocked(tx, actor.storeId, id);
        if (!row || row.consumed
          || (row.held ? row.revision !== revision : !ownedBy(row, actor) || ![row.revision, row.revision - 1].includes(revision))) {
          throw new ApiError(409, "HELD_CONFLICT");
        }
        const active = dto(row.held ? await tx.heldSale.update({
          where: { id }, data: { ...owner(actor), held: false, revision: { increment: 1 } },
        }) : row);
        const [products, member] = await Promise.all([
          tx.product.findMany({
            where: { storeId: actor.storeId, id: { in: active.draft.lines.map(({ productId }) => productId) } },
            select: productSelection,
          }),
          active.draft.memberId ? tx.member.findFirst({
            where: { id: active.draft.memberId, storeId: actor.storeId, isActive: true }, select: memberSelection,
          }) : null,
        ]);
        return { ...active, products: products.map(productForRegister), member };
      });
    },
  };
}
