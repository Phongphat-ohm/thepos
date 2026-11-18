# Phase 6 — Dashboard, Reports, and Shifts

- One open shift per terminal. An operator counts the drawer against opening float, cash sales, cash refunds and recorded cash movements. An authorized manager PIN is required when the absolute variance exceeds `CASH_VARIANCE_LIMIT`. Its default is 0.00 baht because the project does not specify a threshold. Older receipts without a shift remain in sales reports.
- Cash payouts from the drawer post an outgoing movement in the same transaction as the payout. Office cash and bank payouts remain independent of the drawer.
- Reports use Bangkok calendar days. Sales and returns contribute on their own posting dates. Gross profit uses original lot cost or a saved non-stock unit cost. Sellable returns restore cost and damaged returns retain the original cost. Historical lines without a category snapshot use the current category.
- Dashboard and reports apply permission checks on the server. Verify split cash, returns, payout and close races, manager approval, lot-cost reconciliation, role privacy and Thai exports.
- The dashboard flags stock of five or fewer base units and lots expiring within 30 days. Reports accept up to 366 days and show up to 10,000 matching rows. Excel preserves numeric cells where the value fits Excel's precision. PDF uses rendered Thai pages with repeated headers and page numbers.
