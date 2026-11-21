use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Command {
    Startup,
    SetupDevices,
    VerifyAdmin {
        input: Credentials,
    },
    Connect {
        url: String,
        server_key: String,
    },
    Bootstrap {
        input: Bootstrap,
    },
    Enroll {
        input: Enroll,
    },
    Login {
        input: Credentials,
    },
    Profile,
    Lock,
    Unlock {
        pin: String,
    },
    Logout,
    Business {
        route: BusinessRoute,
        query: Option<BusinessQuery>,
        id: Option<String>,
        key: Option<String>,
        input: Option<Value>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BusinessRoute {
    // Auth
    ChangePassword,
    // Reports & Dashboard
    Dashboard,
    Reports,
    // Shifts
    Shifts,
    OpenShift,
    ShiftDetail,
    ShiftMovement,
    CloseShift,
    // Settings
    StoreSettings,
    UpdateStoreSettings,
    Users,
    CreateUser,
    UpdateUser,
    DeleteUser,
    Devices,
    CreateDevice,
    UpdateDevice,
    DeleteDevice,
    AuditLogs,
    // Catalog
    Products,
    CreateProduct,
    UpdateProduct,
    Categories,
    CreateCategory,
    Suppliers,
    CreateSupplier,
    UpdateSupplier,
    SetSupplierStatus,
    ImportPreview,
    ImportCommit,
    // Inventory
    Lots,
    Movements,
    Receive,
    // Stock Counts
    StockCounts,
    SubmitCount,
    ReviewCount,
    // Mobile Stock Counts
    CountSessions,
    CreateCountSession,
    CountSessionDetail,
    UpdateCountSessionStatus,
    RevokeCountParticipant,
    UpdateCountSessionEntry,
    DeleteCountSessionEntry,
    FinalizeCountSession,
    // Sales / POS & Returns
    PosLookup,
    PosCategories,
    PosMembers,
    AddMember,
    HeldList,
    HoldBill,
    ResumeBill,
    SalesHistory,
    SaleDetail,
    Checkout,
    ReturnQuote,
    ReturnSale,
    // Members & Shares
    Members,
    MemberDetail,
    CreateMember,
    UpdateMember,
    MemberPurchases,
    MemberShares,
    PostShares,
    // Dividends & Payouts
    DividendRules,
    CreateDividendRule,
    AccountingPeriods,
    CreateAccountingPeriod,
    UpdateAccountingPeriod,
    CalculateDividend,
    DividendPreview,
    ApproveDividend,
    AdjustPurchases,
    CloseAccountingPeriod,
    PayoutObligations,
    PayoutHistory,
    PostPayout,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    product_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    receivable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stock_tracked: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_only: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exclude_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_col: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    #[serde(flatten)]
    credentials: Credentials,
    store_name: String,
    store_address: Option<String>,
    tax_id: Option<String>,
    device_name: String,
    device_pin: Option<String>,
    display_name: String,
    pin: String,
    secret: String,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum Enroll {
    Bind {
        #[serde(flatten)]
        credentials: Credentials,
        #[serde(rename = "deviceId")]
        device_id: String,
        pin: String,
    },
    Create {
        #[serde(flatten)]
        credentials: Credentials,
        #[serde(rename = "deviceName")]
        device_name: String,
        #[serde(rename = "devicePin", skip_serializing_if = "Option::is_none")]
        device_pin: Option<String>,
    },
}

#[derive(Deserialize, Serialize)]
pub struct Credentials {
    username: String,
    password: String,
}

impl BusinessRoute {
    pub fn endpoint(self, id: Option<&str>) -> Result<(Method, String), String> {
        let id = || {
            id.filter(|value| {
                value.len() == 36
                    && value.bytes().enumerate().all(|(offset, byte)| {
                        if matches!(offset, 8 | 13 | 18 | 23) {
                            byte == b'-'
                        } else {
                            byte.is_ascii_hexdigit()
                        }
                    })
            })
            .ok_or("INVALID_INPUT")
        };
        let endpoint = match self {
            // Auth
            Self::ChangePassword => (Method::POST, "auth/change-password"),
            // Reports & Dashboard
            Self::Dashboard => (Method::GET, "dashboard"),
            Self::Reports => (Method::GET, "reports"),
            // Shifts
            Self::Shifts => (Method::GET, "shifts"),
            Self::OpenShift => (Method::POST, "shifts"),
            Self::ShiftDetail => return Ok((Method::GET, format!("shifts/{}", id()?))),
            Self::ShiftMovement => return Ok((Method::POST, format!("shifts/{}/movements", id()?))),
            Self::CloseShift => return Ok((Method::POST, format!("shifts/{}/close", id()?))),
            // Settings
            Self::StoreSettings => (Method::GET, "settings/store"),
            Self::UpdateStoreSettings => (Method::PUT, "settings/store"),
            Self::Users => (Method::GET, "settings/users"),
            Self::CreateUser => (Method::POST, "settings/users"),
            Self::UpdateUser => return Ok((Method::PUT, format!("settings/users/{}", id()?))),
            Self::DeleteUser => return Ok((Method::DELETE, format!("settings/users/{}", id()?))),
            Self::Devices => (Method::GET, "settings/devices"),
            Self::CreateDevice => (Method::POST, "settings/devices"),
            Self::UpdateDevice => return Ok((Method::PATCH, format!("settings/devices/{}", id()?))),
            Self::DeleteDevice => return Ok((Method::DELETE, format!("settings/devices/{}", id()?))),
            Self::AuditLogs => (Method::GET, "settings/audit-logs"),
            // Catalog
            Self::Products => (Method::GET, "catalog/products"),
            Self::CreateProduct => (Method::POST, "catalog/products"),
            Self::UpdateProduct => return Ok((Method::PUT, format!("catalog/products/{}", id()?))),
            Self::Categories => (Method::GET, "catalog/categories"),
            Self::CreateCategory => (Method::POST, "catalog/categories"),
            Self::Suppliers => (Method::GET, "catalog/suppliers"),
            Self::CreateSupplier => (Method::POST, "catalog/suppliers"),
            Self::UpdateSupplier => return Ok((Method::PUT, format!("catalog/suppliers/{}", id()?))),
            Self::SetSupplierStatus => {
                return Ok((Method::PATCH, format!("catalog/suppliers/{}/status", id()?)))
            }
            Self::ImportPreview => (Method::POST, "catalog/import/preview"),
            Self::ImportCommit => (Method::POST, "catalog/import/commit"),
            // Inventory
            Self::Lots => (Method::GET, "inventory/lots"),
            Self::Movements => (Method::GET, "inventory/movements"),
            Self::Receive => (Method::POST, "inventory/receipts"),
            // Stock Counts
            Self::StockCounts => (Method::GET, "inventory/counts"),
            Self::SubmitCount => (Method::POST, "inventory/counts"),
            Self::ReviewCount => {
                return Ok((Method::POST, format!("inventory/counts/{}/review", id()?)))
            }
            // Mobile Stock Counts
            Self::CountSessions => (Method::GET, "inventory/count-sessions"),
            Self::CreateCountSession => (Method::POST, "inventory/count-sessions"),
            Self::CountSessionDetail => {
                return Ok((Method::GET, format!("inventory/count-sessions/{}", id()?)))
            }
            Self::UpdateCountSessionStatus => {
                return Ok((Method::PATCH, format!("inventory/count-sessions/{}/status", id()?)))
            }
            Self::RevokeCountParticipant => {
                return Ok((
                    Method::POST,
                    format!("inventory/count-sessions/{}/revoke-participant", id()?),
                ))
            }
            Self::UpdateCountSessionEntry => {
                return Ok((Method::PATCH, format!("inventory/count-sessions/{}/entries", id()?)))
            }
            Self::DeleteCountSessionEntry => {
                return Ok((
                    Method::POST,
                    format!("inventory/count-sessions/{}/delete-entry", id()?),
                ))
            }
            Self::FinalizeCountSession => {
                return Ok((
                    Method::POST,
                    format!("inventory/count-sessions/{}/finalize", id()?),
                ))
            }
            // Sales / POS & Returns
            Self::PosLookup => (Method::GET, "sales/products"),
            Self::PosCategories => (Method::GET, "sales/categories"),
            Self::PosMembers => (Method::GET, "sales/members"),
            Self::AddMember => (Method::POST, "sales/members"),
            Self::HeldList => (Method::GET, "sales/held"),
            Self::HoldBill => return Ok((Method::PUT, format!("sales/held/{}", id()?))),
            Self::ResumeBill => return Ok((Method::POST, format!("sales/held/{}/resume", id()?))),
            Self::SalesHistory => (Method::GET, "sales"),
            Self::SaleDetail => return Ok((Method::GET, format!("sales/{}", id()?))),
            Self::Checkout => (Method::POST, "sales"),
            Self::ReturnQuote => {
                return Ok((Method::POST, format!("sales/{}/returns/quote", id()?)))
            }
            Self::ReturnSale => return Ok((Method::POST, format!("sales/{}/returns", id()?))),
            // Members & Shares
            Self::Members => (Method::GET, "members"),
            Self::MemberDetail => return Ok((Method::GET, format!("members/{}", id()?))),
            Self::CreateMember => (Method::POST, "members"),
            Self::UpdateMember => return Ok((Method::PUT, format!("members/{}", id()?))),
            Self::MemberPurchases => return Ok((Method::GET, format!("members/{}/purchases", id()?))),
            Self::MemberShares => return Ok((Method::GET, format!("members/{}/shares", id()?))),
            Self::PostShares => return Ok((Method::POST, format!("members/{}/shares", id()?))),
            // Dividends & Payouts
            Self::DividendRules => (Method::GET, "dividends/rules"),
            Self::CreateDividendRule => (Method::POST, "dividends/rules"),
            Self::AccountingPeriods => (Method::GET, "dividends/periods"),
            Self::CreateAccountingPeriod => (Method::POST, "dividends/periods"),
            Self::UpdateAccountingPeriod => {
                return Ok((Method::PUT, format!("dividends/periods/{}", id()?)))
            }
            Self::CalculateDividend => {
                return Ok((Method::POST, format!("dividends/periods/{}/preview", id()?)))
            }
            Self::DividendPreview => {
                return Ok((Method::GET, format!("dividends/periods/{}/preview", id()?)))
            }
            Self::ApproveDividend => {
                return Ok((Method::POST, format!("dividends/periods/{}/approve", id()?)))
            }
            Self::AdjustPurchases => {
                return Ok((Method::POST, format!("dividends/periods/{}/adjustments", id()?)))
            }
            Self::CloseAccountingPeriod => {
                return Ok((Method::POST, format!("dividends/periods/{}/close", id()?)))
            }
            Self::PayoutObligations => {
                return Ok((Method::GET, format!("dividends/periods/{}/obligations", id()?)))
            }
            Self::PayoutHistory => {
                return Ok((Method::GET, format!("dividends/obligations/{}/payouts", id()?)))
            }
            Self::PostPayout => {
                return Ok((Method::POST, format!("dividends/obligations/{}/payouts", id()?)))
            }
        };
        Ok((endpoint.0, endpoint.1.into()))
    }
}
