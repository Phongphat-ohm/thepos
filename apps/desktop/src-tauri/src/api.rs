use crate::vault;
use reqwest::{Client, Method, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::{Mutex, RwLock};

const NETWORK: &str = "NETWORK_ERROR";
const INVALID_URL: &str = "INVALID_SERVER_URL";
const SESSION_REQUIRED: &str = "SESSION_REQUIRED";
const DEVICE_REQUIRED: &str = "DEVICE_REQUIRED";

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Command {
    Startup,
    SetupDevices,
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
    Dashboard,
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
    ChangePassword,
    Reports,
    Shifts,
    OpenShift,
    ShiftDetail,
    ShiftMovement,
    CloseShift,
    Products,
    CreateProduct,
    UpdateProduct,
    Categories,
    CreateCategory,
    Suppliers,
    CreateSupplier,
    UpdateSupplier,
    SetSupplierStatus,
    Lots,
    Movements,
    Receive,
    ImportPreview,
    ImportCommit,
    StockCounts,
    SubmitCount,
    ReviewCount,
    PosLookup,
    PosCategories,
    PosMembers,
    AddMember,
    Members,
    MemberDetail,
    CreateMember,
    UpdateMember,
    MemberPurchases,
    MemberShares,
    PostShares,
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
    HeldList,
    HoldBill,
    ResumeBill,
    SalesHistory,
    SaleDetail,
    Checkout,
    ReturnQuote,
    ReturnSale,
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

impl BusinessRoute {
    fn endpoint(self, id: Option<&str>) -> Result<(Method, String), String> {
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
            Self::Dashboard => (Method::GET, "dashboard"),
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
            Self::ChangePassword => (Method::POST, "auth/change-password"),
            Self::Reports => (Method::GET, "reports"),
            Self::Shifts => (Method::GET, "shifts"),
            Self::OpenShift => (Method::POST, "shifts"),
            Self::ShiftDetail => return Ok((Method::GET, format!("shifts/{}", id()?))),
            Self::ShiftMovement => return Ok((Method::POST, format!("shifts/{}/movements", id()?))),
            Self::CloseShift => return Ok((Method::POST, format!("shifts/{}/close", id()?))),
            Self::Products => (Method::GET, "catalog/products"),
            Self::CreateProduct => (Method::POST, "catalog/products"),
            Self::UpdateProduct => return Ok((Method::PUT, format!("catalog/products/{}", id()?))),
            Self::Categories => (Method::GET, "catalog/categories"),
            Self::CreateCategory => (Method::POST, "catalog/categories"),
            Self::Suppliers => (Method::GET, "catalog/suppliers"),
            Self::CreateSupplier => (Method::POST, "catalog/suppliers"),
            Self::UpdateSupplier => return Ok((Method::PUT, format!("catalog/suppliers/{}", id()?))),
            Self::SetSupplierStatus => return Ok((Method::PATCH, format!("catalog/suppliers/{}/status", id()?))),
            Self::Lots => (Method::GET, "inventory/lots"),
            Self::Movements => (Method::GET, "inventory/movements"),
            Self::Receive => (Method::POST, "inventory/receipts"),
            Self::ImportPreview => (Method::POST, "catalog/import/preview"),
            Self::ImportCommit => (Method::POST, "catalog/import/commit"),
            Self::StockCounts => (Method::GET, "inventory/counts"),
            Self::SubmitCount => (Method::POST, "inventory/counts"),
            Self::ReviewCount => {
                return Ok((Method::POST, format!("inventory/counts/{}/review", id()?)))
            }
            Self::PosLookup => (Method::GET, "sales/products"),
            Self::PosCategories => (Method::GET, "sales/categories"),
            Self::PosMembers => (Method::GET, "sales/members"),
            Self::AddMember => (Method::POST, "sales/members"),
            Self::Members => (Method::GET, "members"),
            Self::MemberDetail => return Ok((Method::GET, format!("members/{}", id()?))),
            Self::CreateMember => (Method::POST, "members"),
            Self::UpdateMember => return Ok((Method::PUT, format!("members/{}", id()?))),
            Self::MemberPurchases => return Ok((Method::GET, format!("members/{}/purchases", id()?))),
            Self::MemberShares => return Ok((Method::GET, format!("members/{}/shares", id()?))),
            Self::PostShares => return Ok((Method::POST, format!("members/{}/shares", id()?))),
            Self::DividendRules => (Method::GET, "dividends/rules"),
            Self::CreateDividendRule => (Method::POST, "dividends/rules"),
            Self::AccountingPeriods => (Method::GET, "dividends/periods"),
            Self::CreateAccountingPeriod => (Method::POST, "dividends/periods"),
            Self::UpdateAccountingPeriod => return Ok((Method::PUT, format!("dividends/periods/{}", id()?))),
            Self::CalculateDividend => return Ok((Method::POST, format!("dividends/periods/{}/preview", id()?))),
            Self::DividendPreview => return Ok((Method::GET, format!("dividends/periods/{}/preview", id()?))),
            Self::ApproveDividend => return Ok((Method::POST, format!("dividends/periods/{}/approve", id()?))),
            Self::AdjustPurchases => return Ok((Method::POST, format!("dividends/periods/{}/adjustments", id()?))),
            Self::CloseAccountingPeriod => return Ok((Method::POST, format!("dividends/periods/{}/close", id()?))),
            Self::PayoutObligations => return Ok((Method::GET, format!("dividends/periods/{}/obligations", id()?))),
            Self::PayoutHistory => return Ok((Method::GET, format!("dividends/obligations/{}/payouts", id()?))),
            Self::PostPayout => return Ok((Method::POST, format!("dividends/obligations/{}/payouts", id()?))),
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
        };
        Ok((endpoint.0, endpoint.1.into()))
    }
}

async fn response_value(response: Response) -> Result<Value, String> {
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(Value::Null);
    }
    let replayed = response
        .headers()
        .get("idempotency-replayed")
        .and_then(|header| header.to_str().ok())
        .map(|value| value == "true");
    let data: Value = response.json().await.map_err(|_| NETWORK)?;
    if !status.is_success() {
        return Err(data
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or(NETWORK)
            .to_owned());
    }
    Ok(match replayed {
        Some(replayed) => json!({ "sale": data, "replayed": replayed }),
        None => data,
    })
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

#[derive(Deserialize, Serialize)]
struct SetupStatus {
    initialized: bool,
    registered: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    access_token: String,
    refresh_token: String,
    profile: Value,
}

pub struct Api {
    client: Client,
    path: PathBuf,
    access: RwLock<Option<String>>,
    cached_url: RwLock<Option<String>>,
    cached_device: RwLock<Option<(String, String)>>,
    session_lock: Mutex<()>,
    session_gen: AtomicU64,
}

impl Api {
    pub async fn has_access(&self) -> bool {
        self.access.read().await.is_some()
    }
    pub async fn current_url(&self) -> Result<String, String> {
        self.saved_url().await?.ok_or_else(|| INVALID_URL.into())
    }
    pub fn read_local_logo_png() -> Option<Vec<u8>> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                dirs.push(dir.to_path_buf());
            }
        }
        if let Ok(mut dir) = std::env::current_dir() {
            for _ in 0..4 {
                dirs.push(dir.clone());
                if !dir.pop() {
                    break;
                }
            }
        }
        for dir in dirs {
            let path = dir.join("logo.png");
            if let Ok(bytes) = fs::read(&path) {
                if !bytes.is_empty() && bytes.len() <= 1024 * 1024 {
                    return Some(bytes);
                }
            }
        }
        None
    }

    pub async fn read_brand_logo(&self) -> Option<String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        const CANDIDATES: [(&str, &str); 5] = [
            ("logo.png", "image/png"),
            ("logo.svg", "image/svg+xml"),
            ("logo.webp", "image/webp"),
            ("logo.jpg", "image/jpeg"),
            ("logo.jpeg", "image/jpeg"),
        ];

        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                dirs.push(dir.to_path_buf());
            }
        }
        if let Ok(mut dir) = std::env::current_dir() {
            for _ in 0..4 {
                dirs.push(dir.clone());
                if !dir.pop() {
                    break;
                }
            }
        }
        for dir in dirs {
            for (name, mime) in CANDIDATES {
                let path = dir.join(name);
                if let Ok(bytes) = fs::read(&path) {
                    if !bytes.is_empty() && bytes.len() <= 1024 * 1024 {
                        return Some(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)));
                    }
                }
            }
        }

        if let Ok(Some(url)) = self.saved_url().await {
            if let Ok(resp) = self
                .client
                .get(format!("{}/brand-logo", url.trim_end_matches('/')))
                .timeout(Duration::from_millis(1500))
                .send()
                .await
            {
                if resp.status().is_success() {
                    let mime = resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.split(';').next())
                        .map(str::trim)
                        .filter(|v| v.starts_with("image/"))
                        .unwrap_or("image/png")
                        .to_owned();
                    if let Ok(bytes) = resp.bytes().await {
                        if !bytes.is_empty() && bytes.len() <= 1024 * 1024 {
                            return Some(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)));
                        }
                    }
                }
            }
        }
        None
    }
    pub fn new(path: PathBuf) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .min_tls_version(reqwest::tls::Version::TLS_1_3)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(35))
            .build()?;
        Ok(Self {
            client,
            path,
            access: RwLock::new(None),
            cached_url: RwLock::new(None),
            cached_device: RwLock::new(None),
            session_lock: Mutex::new(()),
            session_gen: AtomicU64::new(0),
        })
    }

    async fn saved_url(&self) -> Result<Option<String>, String> {
        if let Some(url) = self.cached_url.read().await.clone() {
            return Ok(Some(url));
        }
        let loaded = match fs::read_to_string(&self.path) {
            Ok(value) => Some(server_url(&value)?),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(_) => return Err("SECURE_STORAGE_ERROR".into()),
        };
        if let Some(ref url) = loaded {
            *self.cached_url.write().await = Some(url.clone());
        }
        Ok(loaded)
    }

    async fn save_url(&self, url: &str) -> Result<(), String> {
        let parent = self.path.parent().ok_or("SECURE_STORAGE_ERROR")?;
        fs::create_dir_all(parent).map_err(|_| "SECURE_STORAGE_ERROR")?;
        let temp = self.path.with_extension("tmp");
        fs::write(&temp, url).map_err(|_| "SECURE_STORAGE_ERROR")?;
        fs::rename(temp, &self.path).map_err(|_| "SECURE_STORAGE_ERROR")?;
        *self.cached_url.write().await = Some(url.to_owned());
        Ok(())
    }

    async fn device_token(&self, url: &str) -> Result<Option<String>, String> {
        if let Some((cached_url, token)) = self.cached_device.read().await.as_ref() {
            if cached_url == url {
                return Ok(Some(token.clone()));
            }
        }
        let token = vault::read(url, "device")?;
        if let Some(ref value) = token {
            *self.cached_device.write().await = Some((url.to_owned(), value.clone()));
        }
        Ok(token)
    }

    async fn request(
        &self,
        url: &str,
        method: Method,
        path: &str,
        device: Option<&str>,
        refresh: Option<&str>,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut request = self
            .client
            .request(method, format!("{url}/api/v1/{path}"))
            .header("accept", "application/json");
        if path != "health" && path != "setup/verify-connection" {
            if let Some(server_token) = vault::read(url, "server")? {
                request = request.header("x-server-token", server_token);
            }
        }
        if let Some(value) = device {
            request = request.header("x-device-token", value);
        }
        if let Some(value) = refresh {
            request = request.header("x-refresh-token", value);
        }
        if path == "auth/me" {
            let token = self.access.read().await.clone().ok_or(SESSION_REQUIRED)?;
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| NETWORK)?;
        if response.status().as_u16() == 201 {
            return Ok(Value::Null);
        }
        let result = response_value(response).await;
        if let Err(ref error) = result {
            if error == "INVALID_SERVER_KEY" {
                let _ = vault::remove(url, "server");
            }
        }
        result
    }

    async fn check(&self, url: &str) -> Result<SetupStatus, String> {
        let health = self
            .request(url, Method::GET, "health", None, None, None)
            .await?;
        if health.get("ready") != Some(&Value::Bool(true)) {
            return Err(NETWORK.into());
        }
        let device = self.device_token(url).await?;
        let status = self
            .request(
                url,
                Method::GET,
                "setup/status",
                device.as_deref(),
                None,
                None,
            )
            .await?;
        serde_json::from_value(status).map_err(|_| NETWORK.into())
    }

    async fn startup(&self, url: String) -> Result<Value, String> {
        let status = self.check(&url).await?;
        let mut user_name = None;
        if status.registered {
            if vault::read(&url, "refresh")?.is_some() {
                match self.lock(&url).await {
                    Ok(result) => {
                        user_name = result
                            .get("userName")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    }
                    Err(error)
                        if error == SESSION_REQUIRED
                            || error == DEVICE_REQUIRED
                            || error == "FORBIDDEN" =>
                    {
                        vault::remove(&url, "refresh")?;
                    }
                    Err(error) => return Err(error),
                }
            }
        } else {
            let _ = vault::remove(&url, "refresh");
        }
        Ok(json!({ "url": url, "setup": status, "lockedUser": user_name }))
    }

    async fn session_request(
        &self,
        url: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let device = self.device_token(url).await?.ok_or(DEVICE_REQUIRED)?;
        let refresh = vault::read(url, "refresh")?.ok_or(SESSION_REQUIRED)?;
        self.request(url, Method::POST, path, Some(&device), Some(&refresh), body)
            .await
    }

    async fn accept_session(&self, url: &str, value: Value) -> Result<Value, String> {
        let session: SessionResponse = serde_json::from_value(value).map_err(|_| NETWORK)?;
        vault::write(url, "refresh", &session.refresh_token)?;
        self.session_gen.fetch_add(1, Ordering::SeqCst);
        *self.access.write().await = Some(session.access_token);
        Ok(session.profile)
    }

    async fn lock(&self, url: &str) -> Result<Value, String> {
        self.session_gen.fetch_add(1, Ordering::SeqCst);
        *self.access.write().await = None;
        self.session_request(url, "auth/lock", None).await
    }

    async fn register(
        &self,
        url: &str,
        path: &str,
        mut input: Value,
        rotate_on_existing: bool,
    ) -> Result<Value, String> {
        let had_device = self.device_token(url).await?.is_some();
        let device = if rotate_on_existing && had_device {
            vault::rotate_device(url)?
        } else {
            vault::prepare_device(url)?
        };
        *self.cached_device.write().await = Some((url.to_owned(), device.clone()));
        if let Some(fields) = input.as_object_mut() {
            fields.retain(|_, value| !value.is_null());
        }
        match self
            .request(url, Method::POST, path, Some(&device), None, Some(input))
            .await
        {
            Ok(_) => Ok(Value::Null),
            Err(error)
                if (error == "ALREADY_INITIALIZED" && path == "setup/bootstrap")
                    || (error == NETWORK && (!had_device || path == "setup/bootstrap")) =>
            {
                if self.check(url).await.is_ok_and(|status| status.registered) {
                    Ok(Value::Null)
                } else {
                    Err(error)
                }
            }
            Err(error) => Err(error),
        }
    }

    async fn refresh_access(
        &self,
        url: &str,
        failed_token: &str,
        expected_gen: u64,
    ) -> Result<String, String> {
        let _guard = self.session_lock.lock().await;
        if self.session_gen.load(Ordering::SeqCst) != expected_gen {
            return Err("SESSION_LOCKED".into());
        }
        if let Some(current) = self.access.read().await.clone() {
            if current != failed_token {
                return Ok(current);
            }
        }
        let value = self.session_request(url, "auth/refresh", None).await?;
        let session: SessionResponse = serde_json::from_value(value).map_err(|_| NETWORK)?;
        vault::write(url, "refresh", &session.refresh_token)?;
        *self.access.write().await = Some(session.access_token.clone());
        Ok(session.access_token)
    }

    pub async fn execute(&self, command: Command) -> Result<Value, String> {
        let url = match command {
            Command::Startup => {
                let _guard = self.session_lock.lock().await;
                return match self.saved_url().await? {
                    Some(url) => match self.startup(url.clone()).await {
                        Ok(result) => Ok(result),
                        Err(error) if error == "INVALID_SERVER_KEY" => {
                            Ok(json!({ "url": url, "setup": null, "lockedUser": null }))
                        }
                        Err(error) => Err(error),
                    },
                    None => Ok(json!({ "url": null, "setup": null, "lockedUser": null })),
                };
            }
            Command::Connect { url, server_key } => {
                let _guard = self.session_lock.lock().await;
                let url = server_url(&url)?;
                if self.access.read().await.is_some() {
                    return Err("SESSION_LOCKED".into());
                }
                let previous = self.saved_url().await?;
                if let Some(ref saved) = previous {
                    if vault::read(saved, "refresh")?.is_some() {
                        return Err("SESSION_LOCKED".into());
                    }
                }
                let verified = self
                    .request(
                        &url,
                        Method::POST,
                        "setup/verify-connection",
                        None,
                        None,
                        Some(json!({ "serverKey": server_key })),
                    )
                    .await?;
                let server_token = verified
                    .get("serverToken")
                    .and_then(Value::as_str)
                    .ok_or(NETWORK)?;
                vault::write(&url, "server", server_token)?;
                let result = self.startup(url.clone()).await?;
                if let Some(saved) = previous {
                    if saved != url {
                        let _ = vault::remove(&saved, "refresh");
                        *self.cached_device.write().await = None;
                    }
                }
                self.session_gen.fetch_add(1, Ordering::SeqCst);
                self.save_url(&url).await?;
                return Ok(result);
            }
            _ => self.saved_url().await?.ok_or(INVALID_URL)?,
        };

        match command {
            Command::SetupDevices => {
                let device = self.device_token(&url).await?;
                self.request(&url, Method::GET, "setup/devices", device.as_deref(), None, None)
                    .await
            }
            Command::Bootstrap { input } => {
                let _guard = self.session_lock.lock().await;
                if self.access.read().await.is_some() || vault::read(&url, "refresh")?.is_some() {
                    return Err("SESSION_LOCKED".into());
                }
                self.register(&url, "setup/bootstrap", json!(input), false).await
            }
            Command::Enroll { input } => {
                let _guard = self.session_lock.lock().await;
                if self.access.read().await.is_some() || vault::read(&url, "refresh")?.is_some() {
                    return Err("SESSION_LOCKED".into());
                }
                let rotate = matches!(input, Enroll::Create { .. });
                self.register(&url, "devices/enroll", json!(input), rotate).await
            }
            Command::Login { input } => {
                let _guard = self.session_lock.lock().await;
                if vault::read(&url, "refresh")?.is_some() {
                    return Err("SESSION_LOCKED".into());
                }
                let device = self.device_token(&url).await?.ok_or(DEVICE_REQUIRED)?;
                let value = self
                    .request(
                        &url,
                        Method::POST,
                        "auth/login",
                        Some(&device),
                        None,
                        Some(json!(input)),
                    )
                    .await?;
                self.accept_session(&url, value).await
            }
            Command::Profile => {
                let device = self.device_token(&url).await?.ok_or(DEVICE_REQUIRED)?;
                let initial_gen = self.session_gen.load(Ordering::SeqCst);
                let initial_access = self.access.read().await.clone().ok_or("SESSION_LOCKED")?;
                match self
                    .request(&url, Method::GET, "auth/me", Some(&device), None, None)
                    .await
                {
                    Err(error) if error == SESSION_REQUIRED => {
                        let _ = self
                            .refresh_access(&url, &initial_access, initial_gen)
                            .await?;
                        self.request(&url, Method::GET, "auth/me", Some(&device), None, None)
                            .await
                    }
                    result => result,
                }
            }
            Command::Lock => {
                let _guard = self.session_lock.lock().await;
                self.lock(&url).await
            }
            Command::Unlock { pin } => {
                let _guard = self.session_lock.lock().await;
                if self.access.read().await.is_some() {
                    self.lock(&url).await?;
                }
                let value = self
                    .session_request(&url, "auth/unlock", Some(json!({ "pin": pin })))
                    .await?;
                self.accept_session(&url, value).await
            }
            Command::Logout => {
                let _guard = self.session_lock.lock().await;
                self.session_gen.fetch_add(1, Ordering::SeqCst);
                *self.access.write().await = None;
                let _ = self.session_request(&url, "auth/logout", None).await;
                vault::remove(&url, "refresh")?;
                Ok(Value::Null)
            }
            Command::Business {
                route,
                query,
                id,
                key,
                input,
            } => {
                let (method, endpoint) = route.endpoint(id.as_deref())?;
                let device = self.device_token(&url).await?.ok_or(DEVICE_REQUIRED)?;
                let server_token = vault::read(&url, "server")?;
                let send = |access: &str| {
                    let mut request = self
                        .client
                        .request(method.clone(), format!("{url}/api/v1/{endpoint}"))
                        .bearer_auth(access)
                        .header("x-device-token", &device)
                        .header("accept", "application/json");
                    if let Some(token) = &server_token {
                        request = request.header("x-server-token", token);
                    }
                    if let Some(query) = &query {
                        request = request.query(query);
                    }
                    if let Some(key) = &key {
                        request = request.header("idempotency-key", key);
                    }
                    if let Some(input) = &input {
                        request = request.json(input);
                    }
                    request
                };
                let initial_gen = self.session_gen.load(Ordering::SeqCst);
                let initial_access = self.access.read().await.clone().ok_or("SESSION_LOCKED")?;
                let response = send(&initial_access)
                    .send()
                    .await
                    .map_err(|_| NETWORK)?;
                let result = match response_value(response).await {
                    Err(error) if error == SESSION_REQUIRED => {
                        let refreshed = self
                            .refresh_access(&url, &initial_access, initial_gen)
                            .await?;
                        let retry = send(&refreshed);
                        response_value(retry.send().await.map_err(|_| NETWORK)?).await
                    }
                    result => result,
                };
                if let Err(ref error) = result {
                    if error == "INVALID_SERVER_KEY" {
                        let _ = vault::remove(&url, "server");
                    }
                }
                result
            }
            Command::Connect { .. } | Command::Startup => unreachable!(),
        }
    }
}

fn is_blocked_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_unspecified() || ip.is_link_local() || ip.is_multicast() || ip.is_broadcast()
}

fn is_blocked_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_blocked_ipv4(v4);
    }
    let first = ip.segments()[0];
    let is_link_local = (first & 0xffc0) == 0xfe80;
    let is_ula = (first & 0xfe00) == 0xfc00;
    ip.is_unspecified() || ip.is_multicast() || is_link_local || is_ula
}

fn server_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.starts_with("\\\\") || trimmed.chars().any(char::is_control) {
        return Err(INVALID_URL.into());
    }
    let url = Url::parse(trimmed).map_err(|_| INVALID_URL)?;
    if !(url.scheme() == "https" || url.scheme() == "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(INVALID_URL.into());
    }
    let is_http = url.scheme() == "http";
    let host_str = url.host_str().ok_or(INVALID_URL)?;
    if host_str.is_empty() {
        return Err(INVALID_URL.into());
    }
    let stripped = host_str.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = stripped.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                if is_blocked_ipv4(v4) || (is_http && !(v4.is_loopback() || v4.is_private())) {
                    return Err(INVALID_URL.into());
                }
            }
            IpAddr::V6(v6) => {
                if is_blocked_ipv6(v6) {
                    return Err(INVALID_URL.into());
                }
                let allowed_http = v6.is_loopback()
                    || v6
                        .to_ipv4_mapped()
                        .is_some_and(|v4| v4.is_loopback() || v4.is_private());
                if is_http && !allowed_http {
                    return Err(INVALID_URL.into());
                }
            }
        }
    } else if is_http && !host_str.eq_ignore_ascii_case("localhost") {
        return Err(INVALID_URL.into());
    }
    Ok(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::server_url;

    #[test]
    fn accepts_http_and_https_origins_without_path_or_credentials() {
        assert_eq!(
            server_url(" https://pos.example.com/ ").unwrap(),
            "https://pos.example.com"
        );
        assert_eq!(
            server_url("http://192.168.1.10:3000/").unwrap(),
            "http://192.168.1.10:3000"
        );
        assert_eq!(
            server_url("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
        assert_eq!(
            server_url("http://localhost:3000").unwrap(),
            "http://localhost:3000"
        );
        assert!(server_url("http://pos.example.com").is_err());
        assert!(server_url("http://169.254.169.254").is_err());
        assert!(server_url("https://[fe80::1]:3000").is_err());
        assert!(server_url("https://[fd00:ec2::254]").is_err());
        assert!(server_url("https://pos.example.com/api/v1").is_err());
        assert!(server_url("https://user:password@pos.example.com").is_err());
        assert!(server_url("ftp://pos.example.com").is_err());
    }
}
