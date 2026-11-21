import type { Permission, Profile, ReportKind } from "@thepos/contracts";

export const reportOptions: { kind: ReportKind; label: string; permission: Permission }[] = [
  { kind: "daily", label: "ยอดขายรายวัน", permission: "report:sales" },
  { kind: "monthly", label: "ยอดขายรายเดือน", permission: "report:sales" },
  { kind: "product", label: "ยอดขายตามสินค้า", permission: "report:sales" },
  { kind: "category", label: "ยอดขายตามหมวดหมู่", permission: "report:sales" },
  { kind: "cashier", label: "ยอดขายตามแคชเชียร์", permission: "report:sales" },
  { kind: "payment", label: "ยอดชำระตามวิธีจ่าย", permission: "report:sales" },
  { kind: "profit", label: "กำไรขั้นต้น", permission: "report:profit" },
  { kind: "stock", label: "สินค้าคงคลัง", permission: "inventory:read" },
  { kind: "movement", label: "ประวัติการเคลื่อนไหวสต็อก", permission: "inventory:read" },
  { kind: "expiry", label: "วันหมดอายุของล็อต", permission: "inventory:read" },
  { kind: "members", label: "ยอดซื้อและบัญชีหุ้นสมาชิก", permission: "member:read" },
  { kind: "dividends", label: "สรุปปันผลและเฉลี่ยคืนตามงวด", permission: "dividend:read" },
  { kind: "payouts", label: "ประวัติการจ่ายปันผลและเฉลี่ยคืน", permission: "dividend:read" },
  { kind: "shifts", label: "กระทบยอดเงินสดตามกะ", permission: "shift:review" },
];

export const hasReportPermission = (profile: Profile, permission: Permission) =>
  profile.capabilities?.some((value) => value === permission) ?? false;

export const hasReports = (profile: Profile) =>
  reportOptions.some(({ permission }) => hasReportPermission(profile, permission));
