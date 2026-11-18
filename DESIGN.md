# ThePOS desktop design

Software · Windows point of sale and cooperative administration

Primary action: start a sale from the POS when signed in. The entry screen uses **เข้าสู่ระบบ**. The visual system uses the project's navy palette, Thai Kanit typography, live product UI, and one short entrance for the active workspace.

## Design direction

The cashier needs the next action and the total at a glance. Managers and stock staff need filters, readable tables, and clear steps before committing a change. The application uses a light navigation rail, a cool neutral canvas, white work surfaces, and navy for primary actions and the selected navigation item. Deep navy anchors the sign-in panel and the POS total. Colour carries meaning with a text label.

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--background` | `#f8fafc` |
| Surface | `--surface` | `#ffffff` |
| Main text and dark panels | `--foreground` | `#0f172a` |
| Secondary text | `--muted-foreground` | `#52627a` |
| Primary action | `--primary` | `#1e3a8a` |
| Selected and inset surfaces | `--accent-surface` | `#edf3ff` |
| Dividers | `--border` | `#dce4ef` |
| Payment and success | `--success` | `#0f766e` |
| Destructive action and failure | `--danger` | `#b91c1c` |

Use Kanit at 400 for text and 500–600 for labels and headings. Page titles scale from 25 to 36 px. Maintain aligned, tabular numbers in prices, report columns, balances, and totals. Use 8 px control radii, 12 px panels, and 16 px dialogs. Use a shared outline and solid button family and reserve shadows for elevated surfaces. Interface labels are Thai. Use the terms shown in the existing workflows.

## Page patterns

| Surface | Layout and interaction |
| --- | --- |
| Launch, connection, first-time setup, device registration, sign-in and lock | Shared entry layout with a narrow brand panel and a focused form. Registration groups store, administrator and device data in one scrollable page. |
| Overview | Today's figures from the API occupy the first surface. Real destinations form a list of shortcuts. Session details show the cashier, device and role. |
| POS | Catalogue, current bill and shortcuts are separate working zones. The barcode field sits at the top of the catalogue. The total and payment button sit together at the bottom of the bill. Bill actions and keyboard keys stay visible beside the work at workstation sizes. |
| Sales history and cash shifts | Filters and shift controls stay on the page. Receipts, returns, cash movements and reconciliation use focused dialogs. |
| Members, shares, dividends, rebates and payouts | Lists and account summaries share the same toolbar and table. Create, edit and post actions open a focused dialog. Approval and payment feedback follow the shared transaction pattern. |
| Products and suppliers | Keep separate registries with search and focused edit dialogs. The supplier registry filters active and inactive records. Confirm supplier status changes and retain links from past receipts. |
| Receiving, stock and imports | Keep receiving, lot balances, movement history, count entry, count review and imports on separate pages. Use the shared toolbar, table and field grid. Keep lot and count rows readable using local horizontal scroll. Review quantities and files before submitting. |
| Reports | Criteria precede results. Export actions sit beside the generated report title. Numeric columns align to the end. |
| Store and hardware settings | Administrators edit store and receipt data in a modal. Printer settings apply per workstation. Preview the receipt before printing and confirm the drawer test. Scanner feedback stays beside the test input. |

## Interaction and responsive behaviour

- Keep the primary action close to the content it changes. Use the shared Modal for focused workflows and SweetAlert2 for consequential confirmation and operation feedback. Nested alerts stay above the active dialog.
- During requests, show the shared loading panel, spinner or skeleton. Keep mutation controls unavailable while a write is pending. Honor reduced motion for loading, hover and page entrances.
- Use the shared six-cell PIN input for setup, workstation unlock and manager approvals. Mask each digit and preserve keyboard entry and full-code paste. Workstation unlock submits automatically after six digits.
- Desktop uses a collapsible navigation rail. Compact widths use a drawer and wider touch targets. At narrower widths POS columns stack and compact tiles remain tappable. Dense tables scroll in their own container.
- The sidebar header and account controls stay visible while the middle navigation list scrolls. Each disclosure keeps its own open state through page navigation and changes between the full rail, compact rail and drawer. Open a page's group on its first visit. Filter destinations by permissions before rendering groups.
- Preserve visible focus, labels for icon buttons, skip navigation, route names, and the POS keyboard shortcuts. Review at 1440, 1024, 768 and 390 px with the keyboard, loading, empty and populated states.

## Implementation

- [Desktop tokens and layout](apps/desktop/src/styles.css)
- [Navigation and workspace headings](apps/desktop/src/components/app-shell.tsx)
- [Shared Modal](apps/desktop/src/components/modal.tsx), [SweetAlert2 helpers](apps/desktop/src/lib/alerts.ts), and [loading states](apps/desktop/src/components/loading.tsx)
- [Tables and pagination](apps/desktop/src/features/stock/shared.tsx)

Project requirements and transaction rules are defined in [PROJECT_MASTER_SPEC.md](PROJECT_MASTER_SPEC.md).
