import { z } from "zod";
import { catalogQuery } from "./catalog";
import {
  optionalText,
  passwordSchema as staffPassword,
  pinSchema as staffPin,
  roleSchema as roleCode,
  usernameSchema as staffUsername,
} from "./primitives";

export const storeSettingsInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  address: optionalText(400),
  taxId: z.string().regex(/^\d{13}$/).nullable().default(null),
  receiptHeader: optionalText(300),
  receiptFooter: optionalText(300),
  receiptLogo: z.string().max(48_000).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().default(null),
  vatRate: z.string().regex(/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/).nullable().default(null),
});
export type StoreSettingsInput = z.output<typeof storeSettingsInput>;
export type StoreSettings = StoreSettingsInput & { vatActive: boolean };

export const staffCreateInput = z.strictObject({
  username: staffUsername,
  name: z.string().trim().min(1).max(120),
  password: staffPassword,
  pin: staffPin,
  roles: z.array(roleCode).min(1).max(4).refine((roles) => new Set(roles).size === roles.length),
});
export const staffUpdateInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  roles: z.array(roleCode).min(1).max(4).refine((roles) => new Set(roles).size === roles.length),
  isActive: z.boolean(),
  password: staffPassword.optional(),
  pin: staffPin.optional(),
});
export const deviceCreateInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  pin: staffPin,
});
export const deviceUpdateInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean(),
  pin: staffPin.optional(),
  revokeSessions: z.boolean().optional(),
});
export type StaffCreateInput = z.output<typeof staffCreateInput>;
export type StaffUpdateInput = z.output<typeof staffUpdateInput>;
export type DeviceCreateInput = z.output<typeof deviceCreateInput>;
export type DeviceUpdateInput = z.output<typeof deviceUpdateInput>;
export type StaffAccount = {
  id: string;
  username: string;
  name: string;
  roles: ("ADMIN" | "MANAGER" | "CASHIER" | "STOCK_STAFF")[];
  isActive: boolean;
  canDelete?: boolean;
};
export type RegisteredDevice = {
  id: string;
  name: string;
  createdAt: string;
  isActive: boolean;
  hasPin: boolean;
  isWebDevice?: boolean;
  canDelete: boolean;
  activeUser: string | null;
  sessionLocked: boolean;
};

export const staffQuery = catalogQuery.extend({
  status: z.enum(["active", "inactive", "all"]).default("all"),
});
export const deviceListQuery = catalogQuery.extend({
  status: z.enum(["active", "inactive", "all"]).default("all"),
});
export const auditEventLabels: Record<string, string> = {
  BOOTSTRAP: "ตั้งค่าร้านค้าครั้งแรก",
  DEVICE_ENROLLED: "ลงทะเบียนเครื่อง POS",
  DEVICE_BOUND: "เชื่อมต่อเครื่อง POS เดิม",
  DEVICE_BIND_FAILED: "เชื่อมต่อเครื่อง POS ไม่สำเร็จ",
  ENROLLMENT_FAILED: "ลงทะเบียนเครื่องไม่สำเร็จ",
  LOGIN: "เข้าสู่ระบบ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  LOCK: "ล็อกหน้าจอ",
  UNLOCK: "ปลดล็อกหน้าจอด้วย PIN",
  UNLOCK_FAILED: "ปลดล็อกหน้าจอไม่สำเร็จ",
  LOGOUT: "ออกจากระบบ",
  PASSWORD_CHANGED: "เปลี่ยนรหัสผ่าน",
  PASSWORD_CHANGE_FAILED: "เปลี่ยนรหัสผ่านไม่สำเร็จ",
  STORE_SETTINGS_UPDATED: "แก้ไขข้อมูลร้านค้า",
  USER_CREATED: "เพิ่มบัญชีพนักงาน",
  USER_UPDATED: "แก้ไขบัญชีพนักงาน",
  USER_DELETED: "ลบบัญชีพนักงาน",
  DEVICE_CREATED: "เพิ่มเครื่อง POS",
  DEVICE_UPDATED: "แก้ไขเครื่อง POS",
  DEVICE_SESSION_REVOKED: "ตัดเซสชันเครื่อง POS",
  DEVICE_DELETED: "ลบเครื่อง POS",
  PRODUCT_CREATED: "เพิ่มสินค้า",
  PRODUCT_UPDATED: "แก้ไขสินค้า",
  PRODUCT_IMPORTED: "นำเข้าสินค้า",
  CATEGORY_CREATED: "เพิ่มหมวดหมู่สินค้า",
  SUPPLIER_CREATED: "เพิ่มผู้จัดจำหน่าย",
  SUPPLIER_UPDATED: "แก้ไขผู้จัดจำหน่าย",
  SUPPLIER_REACTIVATED: "เปิดใช้งานผู้จัดจำหน่าย",
  SUPPLIER_DEACTIVATED: "พักใช้งานผู้จัดจำหน่าย",
  GOODS_RECEIVED: "รับสินค้าเข้าคลัง",
  STOCK_COUNT_SUBMITTED: "ส่งใบตรวจนับสต็อก",
  STOCK_COUNT_APPROVED: "อนุมัติใบตรวจนับสต็อก",
  STOCK_COUNT_REJECTED: "ปฏิเสธใบตรวจนับสต็อก",
  SALE_COMPLETED: "บันทึกการขาย",
  SALE_RETURNED: "คืนสินค้า",
  SALE_APPROVAL_FAILED: "อนุมัติส่วนลด/คืนสินค้าไม่สำเร็จ",
  SHIFT_OPENED: "เปิดกะเงินสด",
  SHIFT_CASH_MOVEMENT: "บันทึกเงินเข้า/ออกกะ",
  SHIFT_CLOSED: "ปิดกะเงินสด",
  SHIFT_FORCE_CLOSED: "ผู้จัดการสั่งปิดกะค้าง",
  SHIFT_APPROVAL_FAILED: "อนุมัติผลต่างกะเงินสดไม่สำเร็จ",
  MEMBER_CREATED: "เพิ่มสมาชิก",
  MEMBER_UPDATED: "แก้ไขข้อมูลสมาชิก",
  MEMBER_VIEWED: "ดูข้อมูลสมาชิก",
  SHARE_INITIAL: "เปิดบัญชีหุ้นสมาชิก",
  SHARE_PURCHASE_ADD: "ซื้อหุ้นเพิ่ม",
  SHARE_WITHDRAWAL: "ถอนหุ้น",
  SHARE_TRANSFER: "โอนหุ้น",
  SHARE_CORRECTION: "ปรับปรุงหุ้น",
  DIVIDEND_RULE_VERSION_CREATED: "สร้างกฎปันผล/เฉลี่ยคืน",
  ACCOUNTING_PERIOD_CREATED: "สร้างงวดบัญชีปันผล",
  ACCOUNTING_PERIOD_UPDATED: "แก้ไขงวดบัญชีปันผล",
  DIVIDEND_PREVIEW_CREATED: "คำนวณปันผลจำลอง",
  ACCOUNTING_PERIOD_APPROVED_LOCKED: "อนุมัติและล็อกงวดปันผล",
  ACCOUNTING_PERIOD_CLOSED: "ปิดงวดบัญชีปันผล",
  MEMBER_PURCHASE_ADJUSTED: "ปรับยอดซื้อสุทธิสมาชิก",
  DIVIDEND_PAYOUT_RECORDED: "บันทึกการจ่ายปันผล",
};

export const auditLogQuery = catalogQuery.extend({
  event: z.string().trim().max(64).optional(),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
});
export type AuditLogQuery = z.output<typeof auditLogQuery>;
export type AuditLogEntry = {
  id: string;
  event: string;
  reason: string | null;
  createdAt: string;
  userName: string | null;
  username: string | null;
  deviceName: string | null;
};
