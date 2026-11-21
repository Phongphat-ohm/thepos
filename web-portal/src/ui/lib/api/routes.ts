export type BusinessRoute =
  // Auth
  | "change_password"
  // Reports & Dashboard
  | "dashboard"
  | "reports"
  // Shifts
  | "shifts"
  | "open_shift"
  | "shift_detail"
  | "shift_movement"
  | "close_shift"
  // Settings (Store, Staff, Devices, Audit)
  | "store_settings"
  | "update_store_settings"
  | "users"
  | "create_user"
  | "update_user"
  | "delete_user"
  | "devices"
  | "create_device"
  | "update_device"
  | "delete_device"
  | "audit_logs"
  // Catalog (Products, Categories, Suppliers, Import)
  | "products"
  | "create_product"
  | "update_product"
  | "categories"
  | "create_category"
  | "suppliers"
  | "create_supplier"
  | "update_supplier"
  | "set_supplier_status"
  | "import_preview"
  | "import_commit"
  // Inventory
  | "lots"
  | "movements"
  | "receive"
  // Stock Counts
  | "stock_counts"
  | "submit_count"
  | "review_count"
  // Mobile Stock Counts
  | "count_sessions"
  | "create_count_session"
  | "count_session_detail"
  | "update_count_session_status"
  | "revoke_count_participant"
  | "update_count_session_entry"
  | "delete_count_session_entry"
  | "finalize_count_session"
  // Sales / POS & Returns
  | "pos_lookup"
  | "pos_categories"
  | "pos_members"
  | "add_member"
  | "held_list"
  | "hold_bill"
  | "resume_bill"
  | "sales_history"
  | "sale_detail"
  | "checkout"
  | "return_quote"
  | "return_sale"
  // Members & Shares
  | "members"
  | "member_detail"
  | "create_member"
  | "update_member"
  | "member_purchases"
  | "member_shares"
  | "post_shares"
  // Dividends & Payouts
  | "dividend_rules"
  | "create_dividend_rule"
  | "accounting_periods"
  | "create_accounting_period"
  | "update_accounting_period"
  | "calculate_dividend"
  | "dividend_preview"
  | "approve_dividend"
  | "adjust_purchases"
  | "close_accounting_period"
  | "payout_obligations"
  | "payout_history"
  | "post_payout";

export type BusinessOptions = {
  query?: {
    q?: string;
    after?: string;
    productId?: string;
    limit?: number;
    mode?: "search" | "barcode" | "browse";
    categoryId?: string;
    receivable?: "true";
    stockTracked?: "true";
    activeOnly?: "true";
    excludeId?: string;
    kind?: string;
    start?: string;
    end?: string;
    status?: string;
    page?: number;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    sortCol?: number;
    event?: string;
  };
  id?: string;
  key?: string;
  input?: unknown;
};

export const webRoutes: Record<BusinessRoute, [string, string]> = {
  // Auth
  change_password: ["POST", "auth/change-password"],

  // Reports & Dashboard
  dashboard: ["GET", "dashboard"],
  reports: ["GET", "reports"],

  // Shifts
  shifts: ["GET", "shifts"],
  open_shift: ["POST", "shifts"],
  shift_detail: ["GET", "shifts/:id"],
  shift_movement: ["POST", "shifts/:id/movements"],
  close_shift: ["POST", "shifts/:id/close"],

  // Settings
  store_settings: ["GET", "settings/store"],
  update_store_settings: ["PUT", "settings/store"],
  users: ["GET", "settings/users"],
  create_user: ["POST", "settings/users"],
  update_user: ["PUT", "settings/users/:id"],
  delete_user: ["DELETE", "settings/users/:id"],
  devices: ["GET", "settings/devices"],
  create_device: ["POST", "settings/devices"],
  update_device: ["PATCH", "settings/devices/:id"],
  delete_device: ["DELETE", "settings/devices/:id"],
  audit_logs: ["GET", "settings/audit-logs"],

  // Catalog
  products: ["GET", "catalog/products"],
  create_product: ["POST", "catalog/products"],
  update_product: ["PUT", "catalog/products/:id"],
  categories: ["GET", "catalog/categories"],
  create_category: ["POST", "catalog/categories"],
  suppliers: ["GET", "catalog/suppliers"],
  create_supplier: ["POST", "catalog/suppliers"],
  update_supplier: ["PUT", "catalog/suppliers/:id"],
  set_supplier_status: ["PATCH", "catalog/suppliers/:id/status"],
  import_preview: ["POST", "catalog/import/preview"],
  import_commit: ["POST", "catalog/import/commit"],

  // Inventory
  lots: ["GET", "inventory/lots"],
  movements: ["GET", "inventory/movements"],
  receive: ["POST", "inventory/receipts"],

  // Stock Counts
  stock_counts: ["GET", "inventory/counts"],
  submit_count: ["POST", "inventory/counts"],
  review_count: ["POST", "inventory/counts/:id/review"],

  // Mobile Stock Counts
  count_sessions: ["GET", "inventory/count-sessions"],
  create_count_session: ["POST", "inventory/count-sessions"],
  count_session_detail: ["GET", "inventory/count-sessions/:id"],
  update_count_session_status: ["PATCH", "inventory/count-sessions/:id/status"],
  revoke_count_participant: ["POST", "inventory/count-sessions/:id/revoke-participant"],
  update_count_session_entry: ["PATCH", "inventory/count-sessions/:id/entries"],
  delete_count_session_entry: ["POST", "inventory/count-sessions/:id/delete-entry"],
  finalize_count_session: ["POST", "inventory/count-sessions/:id/finalize"],

  // Sales / POS & Returns
  pos_lookup: ["GET", "sales/products"],
  pos_categories: ["GET", "sales/categories"],
  pos_members: ["GET", "sales/members"],
  add_member: ["POST", "sales/members"],
  held_list: ["GET", "sales/held"],
  hold_bill: ["PUT", "sales/held/:id"],
  resume_bill: ["POST", "sales/held/:id/resume"],
  sales_history: ["GET", "sales"],
  sale_detail: ["GET", "sales/:id"],
  checkout: ["POST", "sales"],
  return_quote: ["POST", "sales/:id/returns/quote"],
  return_sale: ["POST", "sales/:id/returns"],

  // Members & Shares
  members: ["GET", "members"],
  member_detail: ["GET", "members/:id"],
  create_member: ["POST", "members"],
  update_member: ["PUT", "members/:id"],
  member_purchases: ["GET", "members/:id/purchases"],
  member_shares: ["GET", "members/:id/shares"],
  post_shares: ["POST", "members/:id/shares"],

  // Dividends & Payouts
  dividend_rules: ["GET", "dividends/rules"],
  create_dividend_rule: ["POST", "dividends/rules"],
  accounting_periods: ["GET", "dividends/periods"],
  create_accounting_period: ["POST", "dividends/periods"],
  update_accounting_period: ["PUT", "dividends/periods/:id"],
  calculate_dividend: ["POST", "dividends/periods/:id/preview"],
  dividend_preview: ["GET", "dividends/periods/:id/preview"],
  approve_dividend: ["POST", "dividends/periods/:id/approve"],
  adjust_purchases: ["POST", "dividends/periods/:id/adjustments"],
  close_accounting_period: ["POST", "dividends/periods/:id/close"],
  payout_obligations: ["GET", "dividends/periods/:id/obligations"],
  payout_history: ["GET", "dividends/obligations/:id/payouts"],
  post_payout: ["POST", "dividends/obligations/:id/payouts"],
};
