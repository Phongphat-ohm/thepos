# Phase 7 — Settings, Backup and Deployment

- Add administrator-only store settings with an audit event per save. Keep receipt presentation centrally configured and printer queue, paper and ESC/POS settings per workstation. VAT fields are preparatory and sales continue to run with VAT disabled.
- Validate Windows printer test, ESC/POS cut and drawer dispatch, and scanner prefix/suffix using the settings page. Verify that scanner tests stay isolated from checkout.
- Deploy Bun, PostgreSQL and Caddy with Docker Compose. Apply migrations and seed roles before serving requests. Keep the database and API on the container network.
- Run scheduled PostgreSQL backups encrypted with the configured GPG recipient. Restore into a separate empty database and compare its contents against the backup source.
- Document setup and daily use in Thai. Verify settings through Playwright against a separate PostgreSQL database. Verify infrastructure with a local HTTPS Compose deployment and a restore drill.
