# Phase 4 — Membership and Shares

Started 2026-11-16 after Phase 3 completion and the user's instruction to start Phase 4. See the [phase tracker](PHASE_STATUS.md), the [membership requirements](../requirements/SRS.md#35-การจัดการสมาชิกและบัญชีหุ้น-fr-mem), and the [acceptance criteria](../testing/ACCEPTANCE_CRITERIA.md#phase-4-membership-and-shares).

Phase 3 already implemented the F3 cashier lookup, member pricing at checkout, and atomic purchase and return ledger entries. Phase 4 builds on those records and adds the full register and the share ledger.

| Work | Behavior to verify |
| --- | --- |
| Member register | Admins and managers can register, search, update and deactivate members. Cashier lookup returns active members by exact card barcode or phone, with only member number and name. |
| Profile privacy | National IDs use AES-256-GCM with a dedicated server key. API responses show only whether an ID is on file. Profile changes are audited without logging the ID. |
| Purchase ledger | The member screen shows signed sales and returns, their source references, and the exact aggregate of eligible net purchases. Checkout and return retries retain one ledger entry per source transaction. |
| Share ledger | Open accounts, purchase, withdraw, transfer or correct shares. Each entry records its approver, reason, effective date, quantity and unit value. A transfer records two equal and opposite entries in one database transaction. |

Share quantities are whole shares. The unit value is fixed when an account opens. A transfer to an existing account requires the same unit value; for a member without an account, the transfer opens one at the source value. Withdrawals and corrections cannot leave a negative balance. New entries cannot predate the member's registration or the latest existing entry on an affected account. Balances are summed from immutable entries, and corrections add a new entry. Phase 5 owns dividend and rebate calculations and accounting period rules.

For desktop acceptance, sign in as a manager, register two members, open a share account and transfer shares. Compare both histories and balances. At the register, use F3 with a card barcode and a phone number, verify member pricing, and complete a sale and a return. Check the member's purchase ledger against both receipts. Repeat cashier lookup after deactivation and confirm the member is excluded. Record acceptance in the phase tracker before closing the phase.
