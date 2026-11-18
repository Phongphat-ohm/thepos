# Phase 8 UAT

## Chromium acceptance

Run the following from the repository root with the local test PostgreSQL service running. The fixture prepares and cleans up its own database. Use a fresh fixture for a second full run.

```sh
bun run --cwd apps/desktop dev --port 1434
bun --env-file=.env apps/server/test/phase8-browser-api.ts
playwright-cli -s=phase8-acceptance open http://127.0.0.1:1434/
playwright-cli -s=phase8-acceptance run-code --filename apps/desktop/test/phase8-playwright.js
```

Run the Vite and fixture commands in separate terminals. The browser talks to the test bridge on loopback port 1436. It uses real API sessions and a real PostgreSQL database. The browser bridge substitutes the Windows IPC transport during the test.

| Scenario | Result |
| --- | --- |
| Open a cashier shift, scan a product, select a member and produce a receipt at the member price | Passed |
| Replay checkout and reject an oversell | Passed |
| Lock the session, verify API rejection, then unlock using the six-digit PIN | Passed |
| Reject cashier settings and gross-profit API requests and reject stock-staff checkout | Passed |
| Show true lot profit for a manager | Passed |

Screenshots are saved in `output/playwright/phase8-*.png`.

## HTTP workload and security

```sh
bun --env-file=.env apps/server/test/phase8-load.ts
bun --env-file=.env apps/server/test/phase8-security.ts
bun run test:integration --no-file-parallelism
```

The load probe posts 10,000 real checkouts through five terminal sessions and writes timing and reconciliation evidence to `output/playwright/phase8-load.json`. The proxy probe reproduces an open finding described in [SECURITY_AUDIT.md](../../SECURITY_AUDIT.md). Security sign-off remains open while the confirmed findings are outstanding.
