# Phase 5 — Dividends and Purchase Rebates

Implement FR-DIV-01–06 from the [SRS](../requirements/SRS.md) and verify the [Phase 5 acceptance criteria](../testing/ACCEPTANCE_CRITERIA.md). The [financial invariants](../database/FINANCIAL_INVARIANTS.md) govern the calculation and payout workflow.

- Accounting periods use inclusive dates in Asia/Bangkok and cannot overlap. Admins configure periods, create immutable rule versions and approve results. Managers can review results and record payouts. Share dividends use either the closing balance or the average of twelve month-end balances for a full twelve-month period. Purchase rebates use the signed eligible purchase ledger.
- Preview shows separate bases, rates and results by member, with warnings for negative net purchases and empty results. Negative eligible purchases generate a zero rebate. Deactivating a member at POS preserves their historical entitlement. Return entries are counted on the return posting date, including returns on sales from an earlier period.
- Round each category's fund total half up to satang, then distribute residual satang by largest remainder with a stable member order. The total of all member entitlements equals the sum of the two funds.
- Approve the selected preview after the last day of the period. Verify the calculation against current ledgers, persist separate results and payout obligations atomically, and prohibit changes to approved data. Record corrections in an open period.
- Record partial or full payouts in the app by cash from the cooperative office or bank transfer. Record the receipt, operator, time and allocation to the obligation. Phase 6 owns cash drawer payouts and shift reconciliation.
- Verify exact satang reconciliation, stale preview rejection, immutable approval, permission checks, partial payout retries and competing payouts on PostgreSQL. Exercise the workflow on Windows with a separate test database.
