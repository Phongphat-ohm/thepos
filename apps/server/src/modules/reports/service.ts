import { Prisma, type PrismaClient } from "@prisma/client";
import type { Dashboard, Permission, Profile, Report, ReportColumn, ReportKind, ReportQuery } from "@thepos/contracts";
import { bangkokDay, dayDate } from "../../core/date";

const money = (label: string): ReportColumn => ({ label, number: "money" });
const qty = (label: string): ReportColumn => ({ label, number: "quantity" });
const count = (label: string): ReportColumn => ({ label, number: "count" });
const text = (label: string): ReportColumn => ({ label });
const zero = new Prisma.Decimal(0);
export const reportPermissions: Record<ReportKind, Permission> = {
  daily: "report:sales", monthly: "report:sales", product: "report:sales", category: "report:sales", cashier: "report:sales",
  payment: "report:sales", profit: "report:profit", stock: "inventory:read", movement: "inventory:read", expiry: "inventory:read",
  members: "member:read", dividends: "dividend:read", payouts: "dividend:read", shifts: "shift:review",
};

const sql = Prisma.sql;
const saleLabel = (column: Prisma.Sql) => sql`CASE ${column} WHEN 'CASH' THEN 'เงินสด' WHEN 'TRANSFER' THEN 'โอนเงิน' WHEN 'PROMPTPAY' THEN 'พร้อมเพย์' ELSE ${column} END`;
const movementLabel = (column: Prisma.Sql) => sql`CASE ${column} WHEN 'RECEIPT' THEN 'รับเข้า' WHEN 'SALE' THEN 'ขาย'
  WHEN 'RETURN' THEN 'คืนเข้าสต็อก' WHEN 'RETURN_DAMAGED' THEN 'คืนชำรุด' WHEN 'ADJUSTMENT' THEN 'ปรับยอด' ELSE ${column} END`;
function range(start: string, end: string) {
  return { from: new Date(+dayDate(start) - 25_200_000), until: new Date(+dayDate(end) + 86_400_000 - 25_200_000) };
}
type Window = ReturnType<typeof range>;

function events(storeId: string, { from, until }: Window) {
  return sql`WITH events AS (
    SELECT s.completed_at AS at, s.id AS receipt, s.cashier_id, u.name AS cashier,
      i.product_id, p.sku, p.name, i.base_unit, COALESCE(i.category_name,c.name) AS category, i.base_quantity AS quantity,
      i.line_total-i.bill_discount_share AS revenue,
      COALESCE(i.untracked_unit_cost*i.base_quantity, (SELECT SUM(a.quantity_allocated*a.unit_cost_snapshot)
        FROM sale_item_lot_allocations a WHERE a.sale_item_id=i.id), 0) AS cost, false AS returned
    FROM sales s JOIN sale_items i ON i.sale_id=s.id JOIN users u ON u.id=s.cashier_id
      JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id
    WHERE s.store_id=${storeId}::uuid AND s.completed_at >= ${from} AND s.completed_at < ${until}
    UNION ALL
    SELECT r.created_at, r.id, r.cashier_id, u.name, i.product_id, p.sku, p.name, i.base_unit, COALESCE(i.category_name,c.name),
      -ri.base_quantity, -ri.refund,
      CASE WHEN ri.disposition='SELLABLE' THEN -COALESCE(i.untracked_unit_cost*ri.base_quantity,
        (SELECT SUM(a.quantity*original.unit_cost_snapshot) FROM sale_return_allocations a
          JOIN sale_item_lot_allocations original ON original.id=a.sale_allocation_id WHERE a.sale_return_item_id=ri.id),0) ELSE 0 END, true
    FROM sale_returns r JOIN sale_return_items ri ON ri.sale_return_id=r.id JOIN sale_items i ON i.id=ri.sale_item_id
      JOIN users u ON u.id=r.cashier_id JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id
    WHERE r.store_id=${storeId}::uuid AND r.created_at >= ${from} AND r.created_at < ${until}
  )`;
}

function definition(storeId: string, input: ReportQuery): { title: string; columns: ReportColumn[]; query: Prisma.Sql; note?: string } {
  const { start, end, kind } = input;
  const { from, until } = range(start, end);
  const time = sql`to_char(at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')`;
  const toDate = (column: Prisma.Sql) => sql`to_char(${column} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI')`;
  const net = money("ยอดขายสุทธิ (บาท)");
  const receipts = count("บิลขาย");
  const rollup = events(storeId, { from, until });
  switch (kind) {
    case "daily": case "monthly": case "cashier": {
      const key = kind === "daily" ? time : kind === "monthly" ? sql`to_char(at AT TIME ZONE 'Asia/Bangkok','YYYY-MM')` : sql`cashier`;
      const groupBy = kind === "cashier" ? sql`cashier_id` : key;
      const orderBy = kind === "cashier" ? sql`MAX(cashier), cashier_id` : key;
      const display = kind === "cashier" ? sql`MAX(cashier)` : key;
      const label = kind === "daily" ? "วันที่" : kind === "monthly" ? "เดือน" : "แคชเชียร์";
      return { title: `ยอดขายตาม${label}`, columns: [text(label), receipts, money("ขาย (บาท)"), money("คืน (บาท)"), net], query: sql`${rollup}
        SELECT ARRAY[${display}, COUNT(DISTINCT receipt) FILTER (WHERE NOT returned)::text,
          ROUND(COALESCE(SUM(revenue) FILTER (WHERE NOT returned),0),2)::text,
          ROUND(-COALESCE(SUM(revenue) FILTER (WHERE returned),0),2)::text, ROUND(SUM(revenue),2)::text] cells
        FROM events GROUP BY ${groupBy} ORDER BY ${orderBy}` };
    }
    case "product": return { title: "ยอดขายตามสินค้า", columns: [text("SKU"), text("สินค้า"), text("หน่วยหลัก"), qty("จำนวนสุทธิ"), net],
      query: sql`${rollup} SELECT ARRAY[MAX(sku),MAX(name),base_unit,ROUND(SUM(quantity),3)::text,ROUND(SUM(revenue),2)::text] cells
        FROM events GROUP BY product_id,base_unit ORDER BY MAX(sku),MAX(name),base_unit` };
    case "category": return { title: "ยอดขายตามหมวดหมู่", columns: [text("หมวดหมู่"), net], query: sql`${rollup}
      SELECT ARRAY[category,ROUND(SUM(revenue),2)::text] cells FROM events GROUP BY category ORDER BY category` };
    case "profit": return { title: "กำไรขั้นต้นตามต้นทุนขาย", columns: [text("วันที่"), net, money("ต้นทุนขาย (บาท)"), money("กำไรขั้นต้น (บาท)")],
      note: "ต้นทุนใช้ประวัติล็อตและต้นทุนสินค้าที่บันทึกไว้ตอนขาย คืนสินค้าพร้อมขายลดต้นทุนขาย ส่วนของชำรุดยังนับเป็นต้นทุน",
      query: sql`${rollup} SELECT ARRAY[${time},ROUND(SUM(revenue),2)::text,ROUND(SUM(cost),2)::text,
        (ROUND(SUM(revenue),2)-ROUND(SUM(cost),2))::text] cells FROM events GROUP BY ${time} ORDER BY ${time}` };
    case "payment": return { title: "ยอดชำระตามวิธีจ่าย", columns: [text("วิธีชำระ"), money("รับ (บาท)"), money("คืน (บาท)"), net],
      query: sql`WITH entries AS (
        SELECT p.method,p.amount received,0 refunded FROM sale_payments p JOIN sales s ON s.id=p.sale_id
          WHERE s.store_id=${storeId}::uuid AND s.completed_at >= ${from} AND s.completed_at < ${until}
        UNION ALL SELECT p.method,0,f.amount FROM sale_refunds f JOIN sale_returns r ON r.id=f.sale_return_id
          JOIN sale_payments p ON p.id=f.sale_payment_id WHERE r.store_id=${storeId}::uuid AND r.created_at >= ${from} AND r.created_at < ${until})
        SELECT ARRAY[${saleLabel(sql`method`)},ROUND(SUM(received),2)::text,ROUND(SUM(refunded),2)::text,
          ROUND(SUM(received-refunded),2)::text] cells FROM entries GROUP BY method ORDER BY method` };
    case "stock": return { title: "สินค้าคงคลัง", columns: [text("SKU"), text("สินค้า"), text("หน่วยหลัก"), qty("คงเหลือ")], note: "ยอดคงเหลือ ณ เวลาที่ออกรายงาน",
      query: sql`SELECT ARRAY[p.sku,p.name,p.base_unit,ROUND(COALESCE(SUM(l.remaining_quantity),0),3)::text] cells
        FROM products p LEFT JOIN stock_lots l ON l.product_id=p.id WHERE p.store_id=${storeId}::uuid AND p.is_active AND p.track_stock
        GROUP BY p.id ORDER BY p.sku` };
    case "expiry": return { title: "วันหมดอายุของล็อต", columns: [text("SKU"), text("สินค้า"), text("ล็อต"), text("หมดอายุ"), qty("คงเหลือ")],
      query: sql`SELECT ARRAY[p.sku,p.name,l.lot_number,l.expiration_date::text,l.remaining_quantity::text] cells
        FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.store_id=${storeId}::uuid AND p.is_active AND p.track_stock AND p.track_expiration AND l.remaining_quantity>0
          AND l.expiration_date BETWEEN ${start}::date AND ${end}::date ORDER BY l.expiration_date,p.sku,l.lot_number,l.id` };
    case "movement": return { title: "ประวัติการเคลื่อนไหวสต็อก", columns: [text("วันเวลา"), text("สินค้า"), text("ล็อต"), text("รายการ"), qty("จำนวน")],
      query: sql`SELECT ARRAY[${toDate(sql`m.created_at`)},p.sku || ' · ' || p.name,l.lot_number,${movementLabel(sql`m.kind`)},m.quantity::text] cells
        FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id JOIN products p ON p.id=l.product_id
        WHERE p.store_id=${storeId}::uuid AND m.created_at >= ${from} AND m.created_at < ${until} ORDER BY m.created_at DESC,m.id` };
    case "members": return { title: "ยอดซื้อและบัญชีหุ้นสมาชิก", columns: [text("เลขสมาชิก"), text("สมาชิก"), money("ยอดซื้อสุทธิในช่วง"), count("หุ้น ณ วันสิ้นช่วง"), money("มูลค่าหุ้น")],
      query: sql`SELECT ARRAY[m.number,m.name,ROUND(COALESCE(p.amount,0),2)::text,COALESCE(h.quantity,0)::text,ROUND(COALESCE(h.amount,0),2)::text] cells
        FROM members m LEFT JOIN LATERAL (SELECT SUM(l.net_eligible_amount) amount FROM member_purchase_ledgers l
          WHERE l.member_id=m.id AND l.recorded_at >= ${from} AND l.recorded_at < ${until}) p ON true
        LEFT JOIN LATERAL (SELECT SUM(t.share_quantity) quantity,SUM(t.total_amount) amount FROM share_accounts a
          JOIN share_transactions t ON t.share_account_id=a.id WHERE a.member_id=m.id AND t.effective_date<=${end}::date) h ON true
        WHERE m.store_id=${storeId}::uuid ORDER BY m.number` };
    case "dividends": return { title: "สรุปปันผลและเฉลี่ยคืนตามงวด", columns: [text("งวดบัญชี"), money("ปันผล"), money("เฉลี่ยคืน"), money("จ่ายแล้ว"), money("คงค้าง")],
      note: "แสดงงวดที่สิ้นสุดในช่วงวันที่และยอดคงค้างล่าสุด", query: sql`SELECT ARRAY[p.name,
        ROUND(COALESCE(SUM(o.dividend_amount),0),2)::text,ROUND(COALESCE(SUM(o.rebate_amount),0),2)::text,
        ROUND(COALESCE(SUM(a.paid),0),2)::text,ROUND(COALESCE(SUM(o.total_obligation-a.paid),0),2)::text] cells
        FROM accounting_periods p LEFT JOIN payout_obligations o ON o.accounting_period_id=p.id
        LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount),0) paid FROM payout_allocations a WHERE a.obligation_id=o.id) a ON true
        WHERE p.store_id=${storeId}::uuid AND p.end_date BETWEEN ${start}::date AND ${end}::date AND p.status IN ('APPROVED_LOCKED','CLOSED')
        GROUP BY p.id ORDER BY p.end_date,p.id` };
    case "payouts": return { title: "ประวัติการจ่ายปันผลและเฉลี่ยคืน", columns: [text("วันเวลา"), text("เลขที่ใบจ่าย"), text("สมาชิก"), text("วิธีจ่าย"), money("จ่าย (บาท)")],
      query: sql`SELECT ARRAY[${toDate(sql`f.paid_at`)},f.payout_receipt_number,m.number || ' · ' || m.name,
        CASE WHEN f.payment_method='BANK_TRANSFER' THEN 'โอนธนาคาร' WHEN c.id IS NULL THEN 'เงินสดสำนักงาน' ELSE 'เงินสดจากลิ้นชัก' END,f.total_amount::text] cells
        FROM payouts f JOIN payout_allocations a ON a.payout_id=f.id JOIN payout_obligations o ON o.id=a.obligation_id
        JOIN members m ON m.id=o.member_id LEFT JOIN cash_movements c ON c.payout_id=f.id
        WHERE f.store_id=${storeId}::uuid AND f.paid_at >= ${from} AND f.paid_at < ${until} ORDER BY f.paid_at DESC,f.id` };
    case "shifts": return { title: "กระทบยอดเงินสดตามกะ", columns: [text("เปิดกะ"), text("แคชเชียร์และเครื่อง"), money("เงินทอนเริ่มกะ"), money("เงินตามระบบ"), money("นับได้"), money("ขาด / เกิน"), text("ผู้อนุมัติ")],
      query: sql`SELECT ARRAY[${toDate(sql`s.opened_at`)},u.name || ' · ' || d.name,s.opening_float::text,
        COALESCE(s.expected_cash::text,'—'),COALESCE(s.counted_cash::text,'—'),COALESCE(s.variance::text,'—'),COALESCE(a.name,'—')] cells
        FROM cash_shifts s JOIN users u ON u.id=s.cashier_id JOIN devices d ON d.id=s.device_id LEFT JOIN users a ON a.id=s.approved_by
        WHERE s.store_id=${storeId}::uuid AND s.opened_at >= ${from} AND s.opened_at < ${until} ORDER BY s.opened_at DESC,s.id` };
  }
}

export function reportOrder(
  columns: ReportColumn[],
  input: Pick<ReportQuery, "sortCol" | "sortDir">,
): Prisma.Sql {
  const col =
    input.sortCol !== undefined &&
    Number.isInteger(input.sortCol) &&
    input.sortCol >= 0 &&
    input.sortCol < columns.length
      ? input.sortCol
      : undefined;
  if (col === undefined) return sql`ORDER BY row_ord ASC`;
  const isNumeric = !!columns[col]?.number;
  const pgCol = col + 1;
  const numericExpr = sql`CASE WHEN cells[${pgCol}] ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN cells[${pgCol}]::numeric END`;
  if (isNumeric) {
    return input.sortDir === "desc"
      ? sql`ORDER BY ${numericExpr} DESC NULLS LAST, cells ASC, row_ord ASC`
      : sql`ORDER BY ${numericExpr} ASC NULLS LAST, cells ASC, row_ord ASC`;
  }
  return input.sortDir === "desc"
    ? sql`ORDER BY cells[${pgCol}] DESC NULLS LAST, cells ASC, row_ord ASC`
    : sql`ORDER BY cells[${pgCol}] ASC NULLS LAST, cells ASC, row_ord ASC`;
}

export function createReports(db: PrismaClient, now: () => number) {
  return {
    async report(storeId: string, input: ReportQuery): Promise<Report> {
      const { title, columns, query, note } = definition(storeId, input);
      const searchWhere = input.q
        ? sql`WHERE strpos(lower(array_to_string(cells, ' ')), lower(${input.q})) > 0`
        : Prisma.empty;
      const orderedRows = sql`(SELECT cells, ROW_NUMBER() OVER () AS row_ord FROM (${query}) base_rows) report_rows`;
      const orderExpr = reportOrder(columns, input);
      if (input.page) {
        const limit = input.limit ?? 25;
        const offset = (input.page - 1) * limit;
        const [store, rows] = await Promise.all([
          db.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true } }),
          db.$queryRaw<{ cells: string[]; total_count: bigint }[]>`SELECT cells, COUNT(*) OVER() AS total_count FROM ${orderedRows}
            ${searchWhere}
            ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
        ]);
        let total = Number(rows[0]?.total_count ?? 0);
        if (rows.length === 0 && input.page > 1) {
          const [countRow] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM (${query}) report_rows
            ${searchWhere}`;
          total = Number(countRow?.count ?? 0);
        }
        return {
          store: store.name, title, columns, rows: rows.map(({ cells }) => cells), note,
          start: input.start, end: input.end, limited: false,
          total, page: input.page, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)),
        };
      }
      const [store, rows] = await Promise.all([
        db.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true } }),
        db.$queryRaw<{ cells: string[] }[]>`SELECT cells FROM ${orderedRows}
          ${searchWhere}
          ${orderExpr} LIMIT 10001`,
      ]);
      return { store: store.name, title, columns, rows: rows.slice(0, 10000).map(({ cells }) => cells), note,
        start: input.start, end: input.end, limited: rows.length > 10000 };
    },
    async dashboard(profile: Profile): Promise<Dashboard> {
      const storeId = profile.store.id;
      const date = bangkokDay(now());
      const { from, until } = range(date, date);
      const can = (permission: Permission) => profile.capabilities?.some((capability) => capability === permission);
      const personal = !can("report:sales");
      const cashier = personal ? sql`AND cashier_id=${profile.user.id}::uuid` : Prisma.empty;
      const result: Dashboard = { date };
      await Promise.all([
        can("sales:read") && (async () => {
          const [[sales], [returns], [profit]] = await Promise.all([
            db.$queryRaw<{ amount: Prisma.Decimal; count: bigint }[]>`SELECT COALESCE(SUM(net_total),0) amount, COUNT(*) count FROM sales
              WHERE store_id=${storeId}::uuid AND completed_at>=${from} AND completed_at<${until} ${cashier}`,
            db.$queryRaw<{ amount: Prisma.Decimal; count: bigint }[]>`SELECT COALESCE(SUM(net_total),0) amount, COUNT(*) count FROM sale_returns
              WHERE store_id=${storeId}::uuid AND created_at>=${from} AND created_at<${until} ${cashier}`,
            can("report:profit") ? db.$queryRaw<{ amount: Prisma.Decimal }[]>`${events(storeId, { from, until })}
              SELECT ROUND(COALESCE(SUM(revenue),0),2)-ROUND(COALESCE(SUM(cost),0),2) amount FROM events` : Promise.resolve([]),
          ]);
          result.sales = { net: (sales?.amount ?? zero).minus(returns?.amount ?? zero).toFixed(2), receipts: String(sales?.count ?? 0),
            refunds: String(returns?.count ?? 0), personal, ...(profit && { profit: profit.amount.toFixed(2) }) };
        })(),
        can("inventory:read") && (async () => {
          const [summary] = await db.$queryRaw<{ low: bigint; expiring: bigint; expired: bigint }[]>`SELECT
            (SELECT COUNT(*) FROM products p WHERE p.store_id=${storeId}::uuid AND p.is_active AND p.track_stock AND
             COALESCE((SELECT SUM(l.remaining_quantity) FROM stock_lots l WHERE l.product_id=p.id AND (NOT p.track_expiration OR l.expiration_date IS NULL OR l.expiration_date>=${date}::date)),0)<=5) low,
            COUNT(*) FILTER (WHERE p.track_expiration AND l.expiration_date BETWEEN ${date}::date AND ${date}::date+30) expiring,
            COUNT(*) FILTER (WHERE p.track_expiration AND l.expiration_date<${date}::date) expired
            FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.store_id=${storeId}::uuid AND p.is_active AND p.track_stock AND l.remaining_quantity>0`;
          const lots = await db.$queryRaw<NonNullable<Dashboard["stock"]>["lots"]>`SELECT p.name,l.lot_number AS lot,l.expiration_date::text date,l.remaining_quantity::text quantity
            FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE p.store_id=${storeId}::uuid AND p.is_active AND p.track_stock AND p.track_expiration AND l.remaining_quantity>0
              AND l.expiration_date<=${date}::date+30 ORDER BY l.expiration_date,l.id LIMIT 8`;
          result.stock = { low: String(summary?.low ?? 0), expiring: String(summary?.expiring ?? 0), expired: String(summary?.expired ?? 0), lots };
        })(),
        can("dividend:read") && (async () => {
          const [balance] = await db.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(o.total_obligation-COALESCE(a.paid,0)),0) amount
            FROM payout_obligations o JOIN accounting_periods p ON p.id=o.accounting_period_id
            LEFT JOIN LATERAL (SELECT SUM(a.amount) paid FROM payout_allocations a WHERE a.obligation_id=o.id) a ON true
            WHERE p.store_id=${storeId}::uuid AND p.status='APPROVED_LOCKED'`;
          result.payoutBalance = (balance?.amount ?? zero).toFixed(2);
        })(),
      ]);
      return result;
    },
  };
}
