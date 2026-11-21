use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::{Entry, Error};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};

const STORE_ERROR: &str = "SECURE_STORAGE_ERROR";

fn entry(url: &str, kind: &str) -> Result<Entry, String> {
    let origin = URL_SAFE_NO_PAD.encode(Sha256::digest(url.as_bytes()));
    Entry::new("thepos-desktop", &format!("{kind}-{origin}")).map_err(|_| STORE_ERROR.into())
}

pub fn read(url: &str, kind: &str) -> Result<Option<String>, String> {
    match entry(url, kind)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(STORE_ERROR.into()),
    }
}

pub fn write(url: &str, kind: &str, value: &str) -> Result<(), String> {
    entry(url, kind)?
        .set_password(value)
        .map_err(|_| STORE_ERROR.into())
}

pub fn remove(url: &str, kind: &str) -> Result<(), String> {
    match entry(url, kind)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err(STORE_ERROR.into()),
    }
}

pub fn generate_token() -> Result<String, String> {
    let mut bytes = [0; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| STORE_ERROR.to_owned())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
