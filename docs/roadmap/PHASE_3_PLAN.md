# Phase 3 — Core POS and Payments

Phase 3 started on 2026-11-16 after Phase 2 acceptance and explicit authorization. See [Phase Status](./PHASE_STATUS.md) for the verification record.

## Phase 2 handoff

| Requirement | Backend evidence | Desktop evidence |
| --- | --- | --- |
| FR-PROD-01–03 | Catalog integration tests cover exact prices, optional and multiple barcodes, duplicate rejection, and three-decimal base quantities. | Stock Staff created a product with multiple barcodes and edited its member price in Tauri. |
| FR-INV-01–04 | Receipt and deduction tests cover transactional lots, costs, expiry, FEFO/FIFO, replay, and concurrent deductions. | Stock Staff received one case as twelve base units and viewed the lot and movement. |
| FR-PROD-04 | Preview validates duplicates and commit rechecks conflicts and rolls back the entire batch. | CSV and Excel imports passed in Tauri with leading-zero barcode lookup. Duplicate CSV rows could not be committed. |
| FR-INV-05 | Review tests cover role checks, stale balances, repeated approvals, and movement linkage. | Stock Staff submitted a count and a separate Manager account approved it. The resulting lot balance and variance movement matched the count. |

## Initial Phase 3 implementation

- `GET /api/v1/sales/products` supports active catalog search and exact barcode lookup with cashier-safe fields.
- `POST /api/v1/sales` supports guest checkout at regular prices, cash with change, recorded PromptPay or transfer references, and split tender. The API prices alternate units by multiplying the base price by the base quantity and applies Half-Up rounding per line. It rejects a stale quoted base price and commits lot allocations, cost snapshots, payments, and the request record as a unit.
- Checkout takes an idempotency lock before inventory locks, then locks the complete product set in stable ID order. The invoice number uses a PostgreSQL sequence. Rollbacks can leave gaps in that sequence.
- The cashier Desktop workflow, discounts and approval, membership, held bills, receipt hardware, and returns remain Phase 3 work.

## Implementation order

1. **Contracts, migration, and permissions** (FR-POS-02, FR-POS-04–07, FR-RET-01–04). Add shared Zod contracts and migrations for sales, items, lot allocations, payments, held bills, idempotency, approvals, and returns. Use versioned, store-scoped records with server-derived cashier and terminal IDs. Add a POS lookup permission and endpoint for exact barcode matching and active-product search by name or SKU. The current catalog route rejects Cashier and its DTO includes cost price, so give the POS endpoint a DTO with only the fields needed at the register. Keep access and device tokens in the existing native bridge.
2. **Atomic checkout and payment** (FR-POS-04–07, FR-INV-04). Re-read prices and unit conversions on the server and calculate with Decimal. Use Half-Up line rounding, sum rounded lines, apply the bill discount, and require payment allocations to equal the net total. Record cash tender and change, transfer or QR slip references, and split payments. Bind any required Manager PIN approval to the operation and its amounts, with rate limiting and audit attribution. Within one PostgreSQL transaction, lock the complete set of stock product rows in stable ID order, reuse `deductStock` with a shared Bangkok business date, and persist the bill, payments, allocation cost snapshots, movements linked to the sale, audit, and idempotency result. Preserve product, quantity, unit, and price snapshots. Use a unique invoice number and a store-scoped idempotency key with a payload fingerprint. Return the original sale for the same command and a conflict for a changed payload. Test rollback after an earlier line deducts successfully and a later line fails.
3. **Cashier workflow in Tauri** (FR-POS-01–07). Build the Thai keyboard-first register with F2 search/scan focus, F3 member lookup, F4 quantity, F6 switch bill, F7 discount, F8 hold, F9 payment, F10 sales history, Ctrl+N new bill, and Esc close. Use the server for held bill persistence and protect resume and update against competing edits. Held bills and active carts keep stock available until checkout. After a timeout, allow the cashier to recover the committed outcome by resending the same key and payload. Restore focus after modal actions and test sustained USB HID input, including leading-zero barcodes.
4. **Receipt and cash drawer** (FR-POS-08). Print the committed sale snapshot through a scoped Tauri command. Test Thai text and layout on 58 mm and 80 mm ESC/POS devices and verify the drawer pulse on the intended cash workflow. Provide a reprint action from sales history with independent print status. A failed print leaves the sale committed, and reprints and checkout retries preserve the original sale and avoid repeated drawer pulses.
5. **Returns and refunds** (FR-RET-01–04). Find the original sale by receipt number and allow full or partial returns. Require Manager PIN approval. In one idempotent transaction, lock sale and allocation records, enforce the remaining returnable quantity, use original prices and discounts for refunds, and reverse COGS using the original lot cost snapshots. Restore sellable quantities to original lots and record damaged stock disposition separately in the ledger. Link return movements to their source and retain the original sale. Include signed member purchase reversals when member sales are enabled.

## Scope decisions for implementation

- **Membership boundary.** The [traceability matrix](../requirements/REQUIREMENT_TRACEABILITY.md) assigns member pricing and return effects to Phase 3, while the [roadmap](./MASTER_ROADMAP.md) places member lookup, pricing integration, and the purchase ledger in Phase 4. Proposed scope is to build guest checkout first and include the minimum member identity, lookup, and purchase ledger needed to verify F3, member pricing, and sale/return ledger entries by Phase 3 acceptance. Full registration, member administration, and shares stay in Phase 4. Align both documents when this boundary is agreed.
- **Monetary and inventory rules.** Finalize the discount approval threshold, price behavior for alternate units, partial refund rounding and allocation across split tenders, and damaged return disposition before implementation of the relevant workflow. Full return totals must reconcile to the original sale, even after a sequence of partial returns. Apply the existing [financial invariants](../database/FINANCIAL_INVARIANTS.md).
- **Shift boundary.** Use F10 for sale history and reprints in Phase 3. The roadmap places shift opening, closing, and cash reconciliation in Phase 6.

## Acceptance evidence

| Surface | Scenarios to verify |
| --- | --- |
| PostgreSQL and API | Apply migrations on an empty database and on one with Phase 2 data. Sell the last unit concurrently from two registered terminals and require one committed bill, one stock conflict, and a final balance of zero. Send simultaneous retries with one key and verify a single sale, payment set, and movement set. Test a changed payload, failure rollback, FEFO/FIFO, and historical COGS after a catalog price edit. |
| Money and authorization | Reconcile cash change and split tender to the satang. Cover fractional quantities, discount approval thresholds, invalid PIN and cooldown, and denied permissions. Verify server pricing for guests and members using real test database records. |
| Returns | Verify two concurrent returns against the same line, repeated requests, sellable and damaged items, original cost reversal, member purchase reversal, and cumulative partial refunds that exactly match a full refund. |
| Windows and hardware | Complete a sale with keyboard only, scan repeated barcodes with USB HID, hold and resume a bill, and recover from disconnect after checkout commit. Verify the Thai receipt and drawer on real hardware. Confirm that a printer failure and a subsequent reprint preserve the committed sale. |

Use [Phase 3 acceptance criteria](../testing/ACCEPTANCE_CRITERIA.md#phase-3-core-pos-and-payments) and the [test strategy](../testing/TEST_STRATEGY.md) for sign-off.
