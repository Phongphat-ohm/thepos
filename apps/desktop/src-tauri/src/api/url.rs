use reqwest::Url;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

pub const INVALID_URL: &str = "INVALID_SERVER_URL";

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

pub fn server_url(value: &str) -> Result<String, String> {
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
