import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type ShareTransaction } from "@prisma/client";
import type { CatalogQuery, MemberListQuery, MemberProfile, MemberProfileInput, MemberPurchases, MemberShares, ShareEntry, ShareInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import { translateDuplicate, type StoreActor } from "./catalog";
import { lockFinance } from "./finance-lock";
import { pageMeta, resolveOrder } from "./pagination";

const light = { id: true, name: true, number: true };
const profileFields = {
  ...light, phone: true, barcode: true, address: true, joinedOn: true, isActive: true, nationalIdEncrypted: true,
} satisfies Prisma.MemberSelect;
type SelectedMember = Prisma.MemberGetPayload<{ select: typeof profileFields }>;
const day = (date: Date) => date.toISOString().slice(0, 10);
const thaiDay = (now: number) => day(new Date(now + 7 * 60 * 60 * 1000));
const toDate = (date: string) => new Date(date + "T00:00:00Z");
const maxMoney = new Prisma.Decimal("9999999999.99");
const page = (rows: { id: string }[], limit: number) => rows.length > limit ? rows[limit - 1]!.id : null;
const maskPhone = (phone: string | null) => phone ? phone.replace(/^(\d{3})\d+(\d{4})$/, "$1-XXX-$2") : null;

function profile({ nationalIdEncrypted, joinedOn, ...member }: SelectedMember): MemberProfile {
  return { ...member, joinedOn: joinedOn ? day(joinedOn) : null, hasNationalId: nationalIdEncrypted !== null };
}

export function memberSearch(q: string): Prisma.MemberWhereInput {
  return q ? { OR: [
    { number: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } },
    { barcode: q }, { phone: q },
  ] } : {};
}

async function requireMember(db: Prisma.TransactionClient, storeId: string, id: string) {
  const member = await db.member.findFirst({ where: { id, storeId }, select: { id: true, isActive: true, joinedOn: true } });
  if (!member) throw new ApiError(404, "NOT_FOUND");
  return member;
}

async function lockMembers(tx: Prisma.TransactionClient, storeId: string, ids: string[]) {
  await tx.$queryRaw`SELECT id FROM members WHERE store_id = ${storeId}::uuid
    AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}

const entryFields = { approver: { select: { name: true } } } satisfies Prisma.ShareTransactionInclude;
function entry(row: ShareTransaction & { approver: { name: string } }): ShareEntry {
  return {
    id: row.id, transactionType: row.transactionType as ShareInput["type"], shareQuantity: row.shareQuantity,
    unitValue: row.unitValue.toFixed(2), totalAmount: row.totalAmount.toFixed(2), effectiveDate: day(row.effectiveDate),
    recordedAt: row.recordedAt.toISOString(), approvedBy: row.approver.name, reason: row.reason, transferId: row.transferId,
  };
}

async function shareTotals(tx: Prisma.TransactionClient, shareAccountId: string) {
  const result = await tx.shareTransaction.aggregate({ where: { shareAccountId }, _sum: { shareQuantity: true }, _max: { effectiveDate: true } });
  return { shares: result._sum.shareQuantity ?? 0, lastDate: result._max.effectiveDate };
}

export function createMembers(db: PrismaClient, now: () => number, encryptionKey?: string) {
  function encrypt(id: string, nationalId: string) {
    if (!encryptionKey) throw new ApiError(503, "MEMBER_KEY_REQUIRED");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(nationalId, "utf8"), cipher.final()]);
    return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
  }

  return {
    async list(storeId: string, { q, limit, after, activeOnly, excludeId, page: pageNum, sortBy, sortDir }: MemberListQuery) {
      const where = { storeId, ...memberSearch(q), ...(activeOnly && { isActive: true }), ...(excludeId && { id: { not: excludeId } }) };
      const orderBy = resolveOrder<Prisma.MemberOrderByWithRelationInput>(
        {
          number: (dir) => [{ number: dir }, { id: "asc" }],
          name: (dir) => [{ name: dir }, { id: "asc" }],
          isActive: (dir) => [{ isActive: dir }, { number: "asc" }],
        },
        [{ number: "asc" }, { id: "asc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.member.findMany({ where, orderBy, skip: (pageNum - 1) * limit, take: limit, select: { ...light, phone: true, isActive: true } }),
          db.member.count({ where }),
        ]);
        return {
          items: rows.map((row) => ({ ...row, phone: maskPhone(row.phone) })),
          ...pageMeta(total, pageNum, limit),
        };
      }
      if (after) await requireMember(db, storeId, after);
      const rows = await db.member.findMany({
        where, take: limit + 1, orderBy,
        ...(after && { cursor: { id: after }, skip: 1 }),
        select: { ...light, phone: true, isActive: true },
      });
      return {
        items: rows.slice(0, limit).map((row) => ({ ...row, phone: maskPhone(row.phone) })),
        nextCursor: page(rows, limit),
      };
    },
    async detail(actor: StoreActor, id: string) {
      return db.$transaction(async (tx) => {
        const row = await tx.member.findFirst({ where: { storeId: actor.storeId, id }, select: profileFields });
        if (!row) throw new ApiError(404, "NOT_FOUND");
        await audit(tx, actor, "MEMBER_VIEWED", id);
        return profile(row);
      });
    },
    async save(actor: StoreActor, input: MemberProfileInput, existingId?: string) {
      const id = existingId ?? randomUUID();
      const { nationalId, joinedOn, phone, barcode, address, ...identity } = input;
      const today = thaiDay(now());
      if (joinedOn && joinedOn > today) throw new ApiError(400, "INVALID_INPUT");
      return db.$transaction(async (tx) => {
        if (existingId) {
          await lockMembers(tx, actor.storeId, [id]);
          await requireMember(tx, actor.storeId, id);
          if (joinedOn) {
            const earliestShare = await tx.shareTransaction.findFirst({
              where: { account: { memberId: id }, effectiveDate: { lt: toDate(joinedOn) } },
              select: { id: true },
            });
            if (earliestShare) throw new ApiError(400, "INVALID_SHARE_DATE");
          }
        }
        const data = {
          ...identity, phone, barcode, address,
          ...(joinedOn !== undefined ? { joinedOn: joinedOn ? toDate(joinedOn) : null }
            : existingId ? {} : { joinedOn: toDate(today) }),
          ...(nationalId !== undefined && { nationalIdEncrypted: nationalId ? encrypt(id, nationalId) : null }),
        };
        const row = existingId
          ? await tx.member.update({ where: { id }, data, select: profileFields })
          : await tx.member.create({ data: { ...data, id, storeId: actor.storeId }, select: profileFields });
        await audit(tx, actor, existingId ? "MEMBER_UPDATED" : "MEMBER_CREATED", id);
        return profile(row);
      }).catch(translateDuplicate);
    },
    async purchases(storeId: string, id: string, { limit, after, page: pageNum, sortBy, sortDir }: CatalogQuery): Promise<MemberPurchases> {
      return db.$transaction(async (tx) => {
        await requireMember(tx, storeId, id);
        const where = { memberId: id };
        const orderBy = resolveOrder<Prisma.MemberPurchaseLedgerOrderByWithRelationInput>(
          {
            recordedAt: (dir) => [{ recordedAt: dir }, { id: dir }],
            grossAmount: (dir) => [{ grossAmount: dir }, { recordedAt: "desc" }, { id: "desc" }],
            netEligibleAmount: (dir) => [{ netEligibleAmount: dir }, { recordedAt: "desc" }, { id: "desc" }],
            transactionType: (dir) => [{ transactionType: dir }, { recordedAt: "desc" }, { id: "desc" }],
          },
          [{ recordedAt: "desc" }, { id: "desc" }],
          sortBy,
          sortDir,
        );
        const mapRow = (row: Prisma.MemberPurchaseLedgerGetPayload<{ include: { sale: { select: { invoiceNumber: true } }; saleReturn: { select: { id: true } }; adjustment: { select: { id: true; reason: true } } } }>) => ({
          id: row.id, transactionType: row.transactionType, grossAmount: row.grossAmount.toFixed(2),
          netEligibleAmount: row.netEligibleAmount.toFixed(2), recordedAt: row.recordedAt.toISOString(),
          reference: row.sale?.invoiceNumber ?? row.saleReturn?.id ?? row.adjustment?.id ?? null,
          reason: row.adjustment?.reason ?? null,
        });
        if (pageNum) {
          const [rows, total, count] = await Promise.all([
            tx.memberPurchaseLedger.findMany({
              where, skip: (pageNum - 1) * limit, take: limit, orderBy,
              include: { sale: { select: { invoiceNumber: true } }, saleReturn: { select: { id: true } }, adjustment: { select: { id: true, reason: true } } },
            }),
            tx.memberPurchaseLedger.aggregate({ where, _sum: { netEligibleAmount: true } }),
            tx.memberPurchaseLedger.count({ where }),
          ]);
          return {
            items: rows.map(mapRow),
            ...pageMeta(count, pageNum, limit),
            netTotal: total._sum.netEligibleAmount?.toFixed(2) ?? "0.00",
          };
        }
        if (after && !await tx.memberPurchaseLedger.findFirst({ where: { ...where, id: after }, select: { id: true } })) {
          throw new ApiError(404, "NOT_FOUND");
        }
        const [rows, total] = await Promise.all([
          tx.memberPurchaseLedger.findMany({ where, take: limit + 1, orderBy,
            ...(after && { cursor: { id: after }, skip: 1 }),
            include: { sale: { select: { invoiceNumber: true } }, saleReturn: { select: { id: true } },
              adjustment: { select: { id: true, reason: true } } },
          }),
          tx.memberPurchaseLedger.aggregate({ where, _sum: { netEligibleAmount: true } }),
        ]);
        return {
          items: rows.slice(0, limit).map(mapRow),
          nextCursor: page(rows, limit), netTotal: total._sum.netEligibleAmount?.toFixed(2) ?? "0.00",
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    async shares(storeId: string, id: string, { limit, after, page: pageNum, sortBy, sortDir }: CatalogQuery): Promise<MemberShares> {
      return db.$transaction(async (tx) => {
        await requireMember(tx, storeId, id);
        const account = await tx.shareAccount.findUnique({ where: { memberId: id } });
        if (!account) return { account: null, items: [], nextCursor: null, ...(pageNum && { total: 0, page: pageNum, pageSize: limit, totalPages: 1 }) };
        const where = { shareAccountId: account.id };
        const orderBy = resolveOrder<Prisma.ShareTransactionOrderByWithRelationInput>(
          {
            effectiveDate: (dir) => [{ effectiveDate: dir }, { recordedAt: dir }, { id: dir }],
            shareQuantity: (dir) => [{ shareQuantity: dir }, { effectiveDate: "desc" }, { id: "desc" }],
            totalAmount: (dir) => [{ totalAmount: dir }, { effectiveDate: "desc" }, { id: "desc" }],
            transactionType: (dir) => [{ transactionType: dir }, { effectiveDate: "desc" }, { id: "desc" }],
          },
          [{ effectiveDate: "desc" }, { recordedAt: "desc" }, { id: "desc" }],
          sortBy,
          sortDir,
        );
        if (pageNum) {
          const [rows, count, { shares }] = await Promise.all([
            tx.shareTransaction.findMany({ where, skip: (pageNum - 1) * limit, take: limit, include: entryFields, orderBy }),
            tx.shareTransaction.count({ where }),
            shareTotals(tx, account.id),
          ]);
          return {
            account: { totalShares: shares, shareValue: account.shareValue.toFixed(2), currentBalance: account.shareValue.mul(shares).toFixed(2) },
            items: rows.map(entry),
            ...pageMeta(count, pageNum, limit),
          };
        }
        if (after && !await tx.shareTransaction.findFirst({ where: { ...where, id: after }, select: { id: true } })) {
          throw new ApiError(404, "NOT_FOUND");
        }
        const rows = await tx.shareTransaction.findMany({ where, take: limit + 1, include: entryFields,
          orderBy, ...(after && { cursor: { id: after }, skip: 1 }),
        });
        const { shares } = await shareTotals(tx, account.id);
        return { account: { totalShares: shares, shareValue: account.shareValue.toFixed(2),
          currentBalance: account.shareValue.mul(shares).toFixed(2) }, items: rows.slice(0, limit).map(entry), nextCursor: page(rows, limit) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    async postShares(actor: StoreActor, memberId: string, key: string, input: ShareInput) {
      const fingerprint = digest(JSON.stringify({ memberId, ...input }));
      const recipient = input.type === "TRANSFER" ? input.toMemberId : null;
      if (recipient === memberId) throw new ApiError(400, "INVALID_REFERENCE");
      return db.$transaction(async (tx) => {
        const lockKey = `shares:${actor.storeId}:${key}`;
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const previous = await tx.shareRequest.findUnique({ where: { storeId_key: { storeId: actor.storeId, key } },
          include: { entry: { include: entryFields } },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint || previous.entry.approvedBy !== actor.userId) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          return { entry: entry(previous.entry), replayed: true };
        }
        if (input.effectiveDate > thaiDay(now())) throw new ApiError(400, "INVALID_SHARE_DATE");
        const effectiveDate = toDate(input.effectiveDate);
        await lockFinance(tx, actor.storeId);
        const lockedPeriod = await tx.accountingPeriod.findFirst({ where: {
          storeId: actor.storeId, endDate: { gte: effectiveDate }, status: { in: ["APPROVED_LOCKED", "CLOSED"] },
        }, select: { id: true } });
        if (lockedPeriod) throw new ApiError(409, "PERIOD_LOCKED");
        await lockMembers(tx, actor.storeId, recipient ? [memberId, recipient] : [memberId]);
        const member = await requireMember(tx, actor.storeId, memberId);
        if (!member.isActive && (input.type === "INITIAL" || input.type === "PURCHASE_ADD")) throw new ApiError(400, "INVALID_REFERENCE");
        if (member.joinedOn && effectiveDate < member.joinedOn) throw new ApiError(400, "INVALID_SHARE_DATE");
        let account = await tx.shareAccount.findUnique({ where: { memberId } });
        if (input.type === "INITIAL") {
          if (account) throw new ApiError(409, "SHARE_ACCOUNT_CONFLICT");
          account = await tx.shareAccount.create({ data: { memberId, shareValue: input.unitValue } });
        }
        if (!account) throw new ApiError(409, "SHARE_ACCOUNT_CONFLICT");
        const quantity = input.type === "WITHDRAWAL" || recipient || (input.type === "CORRECTION" && input.direction === "REMOVE")
          ? -input.quantity : input.quantity;
        const transferId = recipient ? randomUUID() : null;
        const { shareValue } = account;

        async function append(shareAccountId: string, shareQuantity: number) {
          const { shares, lastDate } = await shareTotals(tx, shareAccountId);
          if (lastDate && effectiveDate < lastDate) throw new ApiError(400, "INVALID_SHARE_DATE");
          const next = shares + shareQuantity;
          if (next < 0) throw new ApiError(409, "INSUFFICIENT_SHARES");
          if (next > 2_147_483_647 || shareValue.mul(next).gt(maxMoney)) throw new ApiError(400, "INVALID_QUANTITY");
          return tx.shareTransaction.create({ data: {
            shareAccountId, shareQuantity, unitValue: shareValue, totalAmount: shareValue.mul(shareQuantity),
            effectiveDate, transferId, reason: input.reason, transactionType: input.type, approvedBy: actor.userId,
          }, include: entryFields });
        }

        const posted = await append(account.id, quantity);
        if (recipient) {
          const target = await requireMember(tx, actor.storeId, recipient);
          if (!target.isActive) throw new ApiError(400, "INVALID_REFERENCE");
          if (target.joinedOn && effectiveDate < target.joinedOn) throw new ApiError(400, "INVALID_SHARE_DATE");
          const to = await tx.shareAccount.findUnique({ where: { memberId: recipient } });
          if (to && !to.shareValue.eq(shareValue)) throw new ApiError(409, "SHARE_ACCOUNT_CONFLICT");
          const receivingAccount = to ?? await tx.shareAccount.create({ data: { memberId: recipient, shareValue } });
          await append(receivingAccount.id, input.quantity);
        }
        await tx.shareRequest.create({ data: { storeId: actor.storeId, key, fingerprint, transactionId: posted.id } });
        await audit(tx, actor, "SHARE_" + input.type, posted.id);
        return { entry: entry(posted), replayed: false };
      });
    },
  };
}
