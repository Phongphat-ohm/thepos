# PROJECT MASTER SPECIFICATION & AI AGENT DIRECTIVE
# COOPERATIVE POS & MEMBER DIVIDEND MANAGEMENT SYSTEM
# ระบบขายหน้าร้านและบริหารจัดการเงินปันผลสมาชิกสหกรณ์ร้านค้าชุมชน

> **FOR ANY AI ASSISTANT / AGENT OPENING THIS REPOSITORY IN A NEW CHAT:**
> 1. Read this entire document first before taking any action.
> 2. Read `docs/roadmap/PHASE_STATUS.md` to determine the current progress and approved phase.
> 3. NEVER start implementing application code or advance to a new phase without explicit user approval (e.g., `START PHASE X`).
> 4. All end-user UI must be in **Thai** (natural, retail-standard terminology). Technical documentation and code identifiers are in English.
> 5. Follow the non-negotiable rules: Planning-first, No fake implementations, Scope discipline, Strict Decimal arithmetic (no floating-point for money/stock), and Mandatory Phase Approval.

---

## 1. PROJECT IDENTITY & MISSION

- **Project Name**: Cooperative POS & Member Dividend Management System
- **Domain**: Community Cooperative Retail Store (สหกรณ์ร้านค้าชุมชน)
- **Scale**: Single store, 2–5 concurrent POS workstations.
- **Client Architecture**: Windows 10/11 Desktop Client (Tauri 2 + React + TypeScript + Vite + Tailwind CSS + shadcn/ui).
- **Backend Architecture**: Centralized Server (Bun + Hono + Zod + Prisma ORM + PostgreSQL 16).
- **Deployment**: Docker Compose on Linux VPS with Caddy HTTPS reverse proxy.
- **Connectivity Model**: Version 1.0 is **Online-only**. Offline synchronization is deferred to v2.0.

---

## 2. NON-NEGOTIABLE EXECUTION RULES FOR AI AGENTS

### 2.1 Planning-First & Phase Discipline
- The system is built strictly in sequence through **Phases 0 to 8**.
- **NEVER** automatically jump from one phase to the next.
- When a phase is completed: run verification, update `docs/roadmap/PHASE_STATUS.md`, present the completion report, and **STOP**. Wait for user command (e.g. `START PHASE X`).
- Fixing issues within an active phase does not authorize starting the next phase.

### 2.2 No Fake Implementations (Zero Mock Tolerance)
- Never create dummy buttons that do nothing.
- Never invent API responses or simulate database records in production workflows.
- Never use floating-point numbers (`number` in JS/TS without Decimal wrapper) for currency or stock quantities.
- Never bypass authentication, permission checks, or idempotency validations to make tests pass.
- Never implement stub methods with `// TODO` and claim the phase is complete.

### 2.3 Strict Monetary & Inventory Precision
- **Monetary calculations**: Must use `decimal.js` (or Prisma `Decimal`) and PostgreSQL `DECIMAL(12,2)` (or `DECIMAL(14,4)` for unit prices/costs).
- **Stock quantities**: Must use `DECIMAL(12,3)` to support precision unit conversions (e.g., fractional kilograms or liters).
- **Stock deduction**: Must use PostgreSQL pessimistic row locking (`SELECT ... FOR UPDATE`) within an atomic transaction.
- **Lot allocation**: FEFO (First Expired, First Out) for expiration-tracked products; FIFO (First In, First Out) for standard goods.
- **Historical snapshots**: Every sale item must permanently snapshot the lot ID, product name, unit price, and actual lot cost at the moment of checkout. Historical COGS must NEVER be recalculated using future/current costs.

### 2.4 Language & Visual Design
- **Modal and SweetAlert2 are required workflow patterns.** Use the shared `Modal` for focused create/edit forms, transaction review, and details that temporarily interrupt the current task. Keep navigation, work queues, dashboards, and filters on their pages. A small input or a frequent POS operation can stay inline when moving it would slow the operator.
- **Use the shared SweetAlert2 helpers** for consequential confirmation, operation failures, and completion feedback. Confirm irreversible or financial actions before posting unless a dedicated review modal already asks for explicit confirmation. Keep field validation and load/retry errors inline when the user can correct or retry them there. Avoid duplicate alerts for the same outcome and verify that an alert raised from a modal appears above it and returns focus correctly.
- **Loading must be visible and accessible.** Use the shared spinner button for submissions, the loading panel for a blocking operation, and a skeleton for the first load of a list or report. A plain loading sentence is insufficient. Preserve labels for assistive technology, respect reduced motion, and guard against duplicate submissions or dismissal while data is being committed.
- **Language**: All end-user interfaces, dialogs, buttons, toast notifications, receipts, and error messages must be in **Thai**.
- **Theme**: **Light Mode only**. Backgrounds: White / Off-white (`#f8fafc`). Primary Accent: Dark Navy Blue (`#0f172a` / `#1e3a8a`).
- **Keyboard-First POS**: Cashiers must be able to operate entirely via keyboard:
  - `F2`: Product search / scan focus
  - `F3`: Member lookup
  - `F4`: Edit quantity
  - `F6`: Switch active bill
  - `F7`: Line / bill discount
  - `F8`: Hold bill
  - `F9`: Payment modal
  - `F10`: Shift & sales history
  - `Ctrl+N`: New bill
  - `Esc`: Cancel / Close modal

---

## 3. CORE BUSINESS MODULES

1. **User & RBAC**: Admin, Manager, Cashier, Stock Staff. Argon2id password & PIN hashing. Session management with desktop auto-lock.
2. **Products & Units**: Multi-barcodes, unit conversions, categories, supplier linkage, cost vs regular vs member pricing.
3. **Inventory & Lots**: Goods receipts, FEFO/FIFO stock movement ledger, stock adjustments with variance approval.
4. **Point of Sale (POS)**: Multiple active bills, held bills, barcode listener, atomic checkout with `Idempotency-Key`, cash/QR/transfer/split payments, ESC/POS thermal printing.
5. **Returns & Refunds**: Lot-aware returns, validation against original sale quantities, manager PIN approval.
6. **Membership & Shares**: General member registration, member card barcodes, member purchase ledger, share account balance, and auditable share increase/decrease transactions.
7. **Dividends & Purchase Rebates**:
   - Separate **Share Dividends** (based on share balance & holding rules) and **Purchase Rebates** (based on net eligible member purchases).
   - Multi-step workflow: Create Period -> Configure Rule Template -> Preview Calculation -> Approval Lock (`APPROVED_LOCKED`) -> Payout Obligations.
   - Irrevocable period lock: Closed periods cannot be mutated.
8. **Cashier Shifts**: Opening float, cash drops, petty cash, physical drawer count, over/short reconciliation, manager sign-off.
9. **Reports & Exports**: Daily/monthly sales, gross profit (real lot cost basis), stock movements, member dividends, Excel/PDF exports.
10. **Hardware & Settings**: Store profile, 58mm/80mm receipt templates, scanner prefix/suffix test, cash drawer kick test, VAT config (disabled by default).

---

## 4. PROJECT STRUCTURE (MONOREPO)

```text
thepos/
├── apps/
│   ├── desktop/                         # Tauri 2 + React + TypeScript POS App
│   └── server/                          # Bun + Hono + Prisma Backend API
├── packages/
│   ├── contracts/                       # Shared Zod schemas & DTOs
│   ├── shared/                          # Universal Decimal math, constants, formatters
│   └── config/                          # Shared ESLint, Prettier, TSConfig
├── infra/
│   ├── docker/                          # Dockerfile, docker-compose, Caddyfile
│   └── backup/                          # GPG encrypted backup & restore scripts
├── docs/                                # Authoritative documentation tree
│   ├── requirements/ (SRS.md, REQUIREMENT_TRACEABILITY.md)
│   ├── architecture/ (SYSTEM_ARCHITECTURE.md, PROJECT_STRUCTURE.md, MODULE_DEPENDENCIES.md, ADR/)
│   ├── database/ (ERD.md, DATA_DICTIONARY.md, FINANCIAL_INVARIANTS.md)
│   ├── roadmap/ (MASTER_ROADMAP.md, PHASE_STATUS.md)
│   ├── security/ (THREAT_MODEL.md, SECURITY_CHECKLIST.md)
│   ├── testing/ (TEST_STRATEGY.md, ACCEPTANCE_CRITERIA.md)
│   └── user-guides/ (INSTALLATION_TH.md, USER_MANUAL_TH.md)
├── PROJECT_MASTER_SPEC.md               # THIS DIRECTIVE
└── README.md
```

---

## 5. PHASE EXECUTION ROADMAP

| Phase | Title | Key Deliverable | Current Status |
|---|---|---|---|
| **Phase 0** | Planning & Architecture | Complete docs tree, ERD, SRS, Roadmap, ADRs | **IN PROGRESS / PLANNING** |
| **Phase 1** | Foundation & Auth | Monorepo setup, Tauri 2 shell, Hono API, Prisma, RBAC, Setup Wizard | PENDING APPROVAL |
| **Phase 2** | Products & Inventory | Products, Barcodes, Units, Lots, FEFO/FIFO, Receipts, Excel Import | PENDING APPROVAL |
| **Phase 3** | Core POS & Sales | Cashier UI, Keyboard-first, Atomic checkout, Receipt print, Returns | PENDING APPROVAL |
| **Phase 4** | Membership & Shares | Member profiles, Member pricing, Purchase ledger, Share transactions | See [phase tracker](docs/roadmap/PHASE_STATUS.md) |
| **Phase 5** | Dividends & Rebates | Accounting periods, Calculation engine, Preview, Approval lock, Payouts | See [phase tracker](docs/roadmap/PHASE_STATUS.md) |
| **Phase 6** | Reports & Shifts | Shift open/close, Cash reconciliation, Dashboards, Excel/PDF export | See [phase tracker](docs/roadmap/PHASE_STATUS.md) |
| **Phase 7** | Settings & Deployment | Store config, Receipt customizer, Docker deployment, Backup automation | See [phase tracker](docs/roadmap/PHASE_STATUS.md) |
| **Phase 8** | Security & UAT | Concurrency test, Financial reconciliation test, OWASP audit, Final UAT | PENDING APPROVAL |

---

## 6. INSTRUCTIONS FOR NEW AI SESSIONS

If you are an AI starting in a new chat:
1. Greet the user in Thai.
2. Check `docs/roadmap/PHASE_STATUS.md` to see which phase was last completed.
3. State clearly which phase is active or waiting for authorization.
4. If the user prompts to start a phase (e.g. `START PHASE X`), verify that all previous phases are marked `COMPLETED` in `PHASE_STATUS.md`.
5. Follow the **Step 1 to Step 7 Workflow**: Inspect -> Plan -> Implement -> Verify -> Document -> Report -> Stop.
