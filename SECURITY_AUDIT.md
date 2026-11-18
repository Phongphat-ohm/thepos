# ThePOS Phase 8 security audit

## Scope

Reviewed the local working tree on 2026-11-17. The scope includes the Hono API, Tauri command boundaries, authentication and authorization, selected sales and member flows, and the documented production Compose configuration. Dynamic checks used isolated PostgreSQL fixtures and loopback services. The workspace did not expose a Git revision. No live store or external target was tested.

The audit uses the [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) as a risk taxonomy. It covers selected controls and does not establish ASVS conformity.

| Critical | High | Medium | Low |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 0 |

## Remediated findings

### Medium — A shared reverse-proxy address can lock every terminal out of authentication

- **Status and confidence** · Resolved. Verified with `bun --env-file=.env apps/server/test/phase8-security.ts`.
- **Location** · `infra/docker/Caddyfile:3`, `apps/server/src/index.ts:26`, `apps/server/src/app.ts:74` and `:139`.

### Medium — The documented deployment runs the API and backups with the PostgreSQL owner credential

- **Status and confidence** · Resolved. Separated `MIGRATION_DATABASE_URL`, `API_DATABASE_URL`, and `BACKUP_DATABASE_URL` in `infra/docker/docker-compose.prod.yml`, `infra/docker/Dockerfile`, and `docs/user-guides/INSTALLATION_TH.md`.

### Low — Member contact reads lack the masking and read audit described by the security checklist

- **Status and confidence** · Resolved. Masked phone numbers in `members.list()` (`08X-XXX-XXXX`) and added `MEMBER_VIEWED` audit logging in `members.detail()`.

## Verified controls and remaining coverage

- Playwright reached the real API with cashier, stock and manager sessions. It verified authorization on the API as well as visible navigation, locked-session rejection and PIN unlock, a member sale and replay, a rejected oversell, and the manager's lot-profit report.
- Existing PostgreSQL integration tests cover authentication throttling, token revocation, encrypted member identifiers, money invariants and store-scoped records. The load probe adds five-terminal contention and verifies stock and idempotency across real HTTP checkouts.
- Reviewed request schemas, body and page limits, parameterized SQL paths, opaque errors, API-only private Docker networking, and the Phase 7 HTTPS and encrypted restore evidence. The audit did not execute a broad live vulnerability scan.
- Local tool discovery found no Semgrep, Gitleaks, Trivy, CodeQL or OSV-Scanner. Dependency advisory scanning and full ASVS coverage remain unverified. This review made no production configuration changes.
