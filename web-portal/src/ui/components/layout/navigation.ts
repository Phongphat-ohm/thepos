import {
  ArrowLeftRight,
  Banknote,
  Barcode,
  Building2,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  Monitor,
  Package,
  PackageCheck,
  Printer,
  Settings,
  Sheet,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react";
import type { Profile } from "@thepos/contracts";
import type { SettingsView } from "@/features/settings/workspace";

export type CatalogView = "products" | "suppliers" | "import";
export type InventoryView = "receive" | "lots" | "movements";
export type StockCountRouteView = "count-entry" | "counts";

export type AppRoute =
  | "home"
  | "pos"
  | "history"
  | "members"
  | "dividends"
  | "reports"
  | "shifts"
  | `catalog:${CatalogView}`
  | `inventory:${InventoryView}`
  | `stock-counts:${StockCountRouteView}`
  | `settings:${SettingsView}`;

export type Permission = NonNullable<Profile["capabilities"]>[number];

export const NAV_GROUPS = [
  { key: "overview", label: "ภาพรวมและรายงาน", icon: LayoutDashboard },
  { key: "sales", label: "ขายหน้าร้าน", icon: ShoppingCart },
  { key: "members", label: "สมาชิกและปันผล", icon: Users },
  { key: "catalog", label: "สินค้าและผู้จัดจำหน่าย", icon: Package },
  { key: "stock", label: "คลังสินค้า", icon: Warehouse },
  { key: "admin", label: "การดูแลระบบ", icon: Settings },
] as const;

export const SESSION_GROUP = { key: "session", label: "บัญชีผู้ใช้", icon: UserRound } as const;
export type PageGroup = (typeof NAV_GROUPS)[number];
export type SidebarGroup = PageGroup | typeof SESSION_GROUP;

export type NavItem = {
  route: AppRoute;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  group: PageGroup["key"];
};

export const NAV_ITEMS: NavItem[] = [
  { route: "home", label: "ภาพรวมระบบ", icon: LayoutDashboard, group: "overview" },
  { route: "reports", label: "รายงาน", icon: Sheet, group: "overview" },
  { route: "pos", label: "ขายหน้าร้าน (POS)", icon: ShoppingCart, permission: "sales:checkout", group: "sales" },
  { route: "history", label: "ประวัติการขาย", icon: History, permission: "sales:read", group: "sales" },
  { route: "shifts", label: "กะเงินสด", icon: ClipboardList, group: "sales" },
  { route: "members", label: "จัดการสมาชิก", icon: Users, permission: "member:read", group: "members" },
  { route: "dividends", label: "ปันผลและเฉลี่ยคืน", icon: Banknote, permission: "dividend:read", group: "members" },
  { route: "catalog:products", label: "รายการสินค้า", icon: Barcode, permission: "catalog:read", group: "catalog" },
  { route: "catalog:suppliers", label: "ผู้จัดจำหน่าย", icon: Building2, permission: "catalog:read", group: "catalog" },
  { route: "catalog:import", label: "นำเข้าไฟล์สินค้า", icon: Sheet, permission: "catalog:write", group: "catalog" },
  { route: "inventory:receive", label: "รับสินค้าเข้าคลัง", icon: PackageCheck, permission: "inventory:receive", group: "stock" },
  { route: "inventory:lots", label: "สต็อกคงเหลือ", icon: Warehouse, permission: "inventory:read", group: "stock" },
  { route: "inventory:movements", label: "ความเคลื่อนไหวสต็อก", icon: ArrowLeftRight, permission: "inventory:read", group: "stock" },
  { route: "stock-counts:count-entry", label: "ตรวจนับสต็อก", icon: ClipboardCheck, permission: "inventory:count", group: "stock" },
  { route: "stock-counts:counts", label: "ใบตรวจนับสต็อก", icon: ClipboardList, permission: "inventory:read", group: "stock" },
  { route: "settings:store", label: "ข้อมูลร้านและใบเสร็จ", icon: Store, permission: "settings:manage", group: "admin" },
  { route: "settings:hardware", label: "เครื่องพิมพ์และอุปกรณ์", icon: Printer, permission: "settings:manage", group: "admin" },
  { route: "settings:staff", label: "บัญชีพนักงาน", icon: Users, permission: "settings:manage", group: "admin" },
  { route: "settings:devices", label: "เครื่อง POS ที่ลงทะเบียน", icon: Monitor, permission: "settings:manage", group: "admin" },
  { route: "settings:audit", label: "บันทึกตรวจสอบ (Audit Log)", icon: ShieldCheck, permission: "settings:manage", group: "admin" },
];

export function canOpenRoute(route: AppRoute, profile: Profile) {
  const item = NAV_ITEMS.find((entry) => entry.route === route);
  return !!item?.permission && (profile.capabilities?.includes(item.permission) ?? false);
}

export const routeDescriptions: Record<Exclude<AppRoute, "home" | "pos">, string> = {
  history: "ค้นหาใบเสร็จและตรวจสอบรายการคืนสินค้า",
  members: "ทะเบียนสมาชิก ยอดซื้อสะสม และบัญชีหุ้น",
  dividends: "จัดการงวดบัญชี คำนวณยอด และบันทึกการจ่าย",
  reports: "เลือกช่วงข้อมูลและส่งออกเป็น Excel หรือ PDF",
  shifts: "เปิดกะ บันทึกเงินเข้าออก และกระทบยอดลิ้นชัก",
  "catalog:products": "จัดการราคา หน่วยนับ และบาร์โค้ด",
  "catalog:suppliers": "ค้นหาและดูข้อมูลติดต่อของผู้จัดจำหน่าย",
  "catalog:import": "ตรวจสอบรายการจากไฟล์ก่อนบันทึกเข้าระบบ",
  "inventory:receive": "บันทึกรับสินค้าตามผู้จัดจำหน่ายและล็อต",
  "inventory:lots": "ตรวจยอดคงเหลือ ผู้จัดจำหน่าย และวันหมดอายุรายล็อต",
  "inventory:movements": "ตรวจรายการรับเข้า ขาย คืน และปรับยอดของสินค้า",
  "stock-counts:count-entry": "บันทึกจำนวนสินค้าที่นับได้แยกตามล็อตเพื่อส่งใบตรวจนับ",
  "stock-counts:counts": "ตรวจสอบใบตรวจนับ อนุมัติปรับยอด หรือไม่อนุมัติตามสิทธิ์",
  "settings:store": "จัดการข้อมูลร้าน ภาษี และข้อความหัว-ท้ายใบเสร็จ",
  "settings:hardware": "ตั้งค่าเครื่องพิมพ์ ทดสอบลิ้นชัก และทดสอบเครื่องสแกนบาร์โค้ด",
  "settings:staff": "เพิ่ม แก้ไข บทบาท และระงับการใช้งานบัญชีพนักงาน",
  "settings:devices": "จัดการเครื่อง POS รหัสเครื่อง และตัดเซสชันที่ค้างอยู่",
  "settings:audit": "ตรวจสอบประวัติการเข้าใช้งานและการแก้ไขข้อมูลสำคัญในระบบ (เฉพาะผู้ดูแลระบบ)",
};
