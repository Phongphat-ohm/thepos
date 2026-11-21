pub mod logo;
pub mod routes;
pub mod url;

pub use routes::Command;

use crate::security::vault;
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};

use routes::Enroll;
use url::{server_url, INVALID_URL};

const NETWORK: &str = "NETWORK_ERROR";
const SESSION_REQUIRED: &str = "SESSION_REQUIRED";
const DEVICE_REQUIRED: &str = "DEVICE_REQUIRED";

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
    admin_verified_at: RwLock<Option<Instant>>,
}

const ADMIN_VERIFY_TTL: Duration = Duration::from_secs(90);

impl Api {
    async fn is_admin_verified(&self) -> bool {
        let guard = self.admin_verified_at.read().await;
        guard.is_some_and(|at| at.elapsed() < ADMIN_VERIFY_TTL)
    }

    async fn clear_admin_verified(&self) {
        *self.admin_verified_at.write().await = None;
    }
    pub async fn has_access(&self) -> bool {
        self.access.read().await.is_some()
    }

    pub fn read_local_logo_png() -> Option<Vec<u8>> {
        logo::read_local_logo_png()
    }

    pub async fn read_brand_logo(&self) -> Option<String> {
        let server = self.saved_url().await.ok().flatten();
        logo::read_brand_logo(&self.client, server).await
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
            admin_verified_at: RwLock::new(None),
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
        let existing_device = self.device_token(url).await?;
        let had_device = existing_device.is_some();
        let rotating = rotate_on_existing && had_device;
        let device = if rotating {
            vault::generate_token()?
        } else if let Some(token) = existing_device {
            token
        } else {
            vault::generate_token()?
        };
        if let Some(fields) = input.as_object_mut() {
            fields.retain(|_, value| !value.is_null());
        }
        let persist_device = || async {
            vault::write(url, "device", &device)?;
            *self.cached_device.write().await = Some((url.to_owned(), device.clone()));
            Ok::<(), String>(())
        };
        match self
            .request(url, Method::POST, path, Some(&device), None, Some(input))
            .await
        {
            Ok(_) => {
                if !had_device || rotating {
                    persist_device().await?;
                }
                Ok(Value::Null)
            }
            Err(error)
                if (error == "ALREADY_INITIALIZED" && path == "setup/bootstrap")
                    || (error == NETWORK && (!had_device || path == "setup/bootstrap")) =>
            {
                if self.check(url).await.is_ok_and(|status| status.registered) {
                    if !had_device || rotating {
                        persist_device().await?;
                    }
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
                self.clear_admin_verified().await;
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
                    if !self.is_admin_verified().await {
                        match self.check(saved).await {
                            Ok(status) if !status.initialized => {}
                            _ => return Err("FORBIDDEN".into()),
                        }
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
                self.clear_admin_verified().await;
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
            Command::VerifyAdmin { input } => {
                let device = self.device_token(&url).await?;
                let res = self
                    .request(
                        &url,
                        Method::POST,
                        "setup/verify-admin",
                        device.as_deref(),
                        None,
                        Some(json!(input)),
                    )
                    .await?;
                *self.admin_verified_at.write().await = Some(Instant::now());
                Ok(res)
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
                self.clear_admin_verified().await;
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
                self.clear_admin_verified().await;
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
                self.clear_admin_verified().await;
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
