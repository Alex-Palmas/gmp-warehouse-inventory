# GMP Warehouse Inventory (DOC-WH-INV-001 v1.2)
Standalone **system of record** for warehouse containers in a pharmaceutical / biotech facility, plus Excel reports and a CSV documentation pack.

**VALIDATION STATUS: Not validated — do not use for GMP decisions until IQ/OQ/PQ approved.**

This application is a technical control set that *can support* 21 CFR Part 11, 21 CFR 211 warehouse/records, EU GMP Annex 11, ALCOA+, and GAMP 5 **after** the site executes IQ/OQ/PQ, trains users, and adopts SOPs. It is **not** certified, validated, or fully compliant as shipped.

Document number: `DOC-WH-INV-001` · Version: `1.2` · App version: `1.2.0`

## Intended use

Local (single-node, browser) inventory register for **per-container** serials (`WH-YYYY-NNNNNN`), receipt batches (`RCV-YYYY-NNNNNN`), goods receipt into Quarantine, QA e-signed lot-release of sibling containers, sampling, material submissions, material requests (`MR-YYYY-NNNNNN`) with FEFO auto-reserve → scan pick → issue, location barcodes, append-only audit trail, JSON backup/restore, and Excel reports (reports are not the system of record).

See `docs/10-Intended-Use-Known-Limitations.md`, `docs/11-Access-Control-Matrix.md`, and `docs/12-Material-Request-and-Serialization.md`.

## How to run

Requires Node.js 18+ (developed on Node 20). From the project directory run the package scripts:

- install dependencies (package.json)
- `dev` — development server (open http://localhost:5173/gmp-warehouse-inventory/)
- `build` — production build
- `preview` — preview the build
- `test` — vitest

Commands:

    cd gmp-warehouse-inventory
    npm install
    npm run dev
    npm run build
    npm test

Data lives in this browser IndexedDB (`gmp-wh-inv`). Clearing site data destroys the local register unless you restored from backup.

## GitHub Pages (private repo)

Intended to deploy from a **private** GitHub repository named `gmp-warehouse-inventory`.

- Pages URL pattern: `https://<user>.github.io/gmp-warehouse-inventory/`
- Workflow: `.github/workflows/pages.yml` on push to `main` (install, test, build, upload dist, deploy Pages).
- **The hosted site is PUBLIC even if the repository is private.** Source stays private; anyone with the Pages URL can load the SPA.
- IndexedDB is per-browser / per-origin. Hosted demo data is local to each visitor. There is no shared server-side inventory.
- Enable Pages: Settings, Pages, Source = GitHub Actions.

## First admin / demo users

Demo accounts are seeded on first launch. **Passwords are documented here only. Production deployments MUST change them before any GMP use. Do not share logins.**

| User ID | Role | Demo temp password |
|---------|------|--------------------|
| sysadmin | System Administrator | Sysadmin123! |
| admin | Warehouse Supervisor | Admin123! |
| qa | QA | Qa123! |
| qc | QC | Qc123! |
| wh | Warehouse Operator | Wh123! |
| ro | Read-Only | Ro123! |
| lab | Requester / Lab-Production | LabUser123!x |

Password storage: PBKDF2-SHA-256 (100000 iterations, 16-byte salt) via Web Crypto. Seeded hashes start as SHA-256(salt:password) and are upgraded to PBKDF2 on first successful login. Last 4 hashes retained. 90-day expiry. 5 failed attempts lock 15 minutes (or until admin unlock). Same error for unknown user vs bad password. First login must change the temp password (min 12 chars, upper+lower+digit+special). Production MUST change all demo passwords.

Idle session timeout is 15 minutes. Re-authentication is required for QA e-signatures (password re-entry; printed name, user ID, datetime, meaning of signature captured).

## Typical flow (OQ-style) — v1.2

1. Log in as `lab` (temp password `LabUser123!x`, 12-char policy). Change password. **Submit material** if the item is not on the master; QA/supervisor approves → Material Master. **Request material**: typeahead, qty, needed-by, Enter. FEFO Released stock is auto-reserved.
2. Log in as `wh`. Change temp password. **Receive**: N containers × qty per container (e.g. 24 vials × 10 mL) → N unique serials, one `receiptBatchId`, all Quarantine. Duplicate last receipt copies material/supplier/location. Print all N labels (Code 128 of serial; QR `serial|lot|expiry|status|containerType`).
3. Scan (HID Enter-terminated). Success/error beep + flash. On Requests, scan adds to the open pick (wrong material/status/expired = error beep, not added).
4. Log in as `qa`. QA Disp. default = release entire receipt batch (one e-sign, audit each serial). Optional single-container reject. Samples: pull sample/retain child serial from a parent.
5. As `wh`, Requests queue: walk-path sorted by location, print pick ticket, pick reserved serials, confirm issue. Movement + audit include `requestId`. Direct Issue remains for emergency.
6. As `lab`, inbox “ready” → confirm received → Closed.
7. Transfer/putaway: scan container, then scan `LOC-…` location barcode. Print location labels from Transfer.
8. Dashboard KPI cards (Quarantine, Released, Hold, Rejected, Restricted, Expired, Exp 30d, Exp 90d, open/reserved requests) are clickable — they open the register or request queue already filtered (`#/register?status=Released`, `#/register?filter=exp30`, `#/requests?view=open`). Clear the filter to see all.
9. `sysadmin` Access matrix (e-sign on save). Audit is append-only (UTC + America/Los_Angeles).

## Print labels

Form Labels (or check Print label after save on receipt). Sizes: 2x1 inch and 4x2 inch. `@media print` hides chrome. Reprint writes audit action PRINT_LABEL. Libraries are vendored (jsbarcode, qrcode) and bundled. No Google Charts, no CDN.

## Scanners

HID keyboard-wedge scanners that type the serial (or QR payload `serial|lot|expiry|status|containerType`, or location `LOC-…`) and send Enter are supported. The SCAN box is on every authenticated page. On the Requests pick page, scan adds the serial to the open request. On Transfer, scan serial then location barcode to put away.

## Backup / restore / Excel

- Dashboard → Backup JSON (capability backupRestore): one file of ALL stores including roles, permission matrix, and matrix history.
- Access page → restore JSON (replaces all local stores; audited).
- Dashboard → Export Excel reports: Inventory Register, Material Master, Movement Log, Audit Trail, User Access Log, Request Log, Material Submissions, Roles, Permission Matrix, User Access List.

Companion workbook: `exports/GMP_Warehouse_Inventory_Register_v1.1.xlsx`

## Residual Part 11 / Annex 11 / IT gaps (honest)

This is a single-node local/browser application. It does **not** provide:

| Gap | Why it matters |
|-----|----------------|
| Qualified hosting / validated infrastructure | No IQ of server, OS, hypervisor, or SaaS. Browser + OS are GxP-unqualified unless the site qualifies them. |
| Certified time synchronization | Timestamps use the workstation clock converted to UTC. No NTP/PTP qualification. |
| Enterprise identity (SSO, AD/LDAP) | Local user table. Shared-login risk is operational, not fully technically prevented across browsers. |
| MFA | Password + lockout + PBKDF2 only. |
| Independent audit-trail archival / WORM | IndexedDB can be wiped with site data. Backup is a user action. |
| Network security, TLS, SIEM | Not a networked service as designed (dev server / static files). |
| Certified electronic signature (biometric, token) | Password re-entry + meaning of signature only. |
| Multi-site replication / conflict control | One browser origin. |
| Vendor certified Part 11 letter | None. Site owns validation. |

ALCOA+ is supported technically (contemporaneous UTC+local audit, attributable user, original IndexedDB record, accurate controlled vocabularies, complete trail, consistent serials, enduring only if backed up, available via UI/export). Enduring/available depend on the site backup SOP.

## CSV pack (`docs/`)

Templates with `[SITE]`, `[OWNER]`, `[DATE]` placeholders — **not pre-approved**:

1. URS (mapped to 21 CFR 11, 211.80–211.94, 211.142, 211.150, 211.180, 211.204, Annex 11, ALCOA+)
2. Functional Specification
3. GAMP 5 risk assessment
4. Traceability matrix URS → function → OQ test
5. IQ protocol
6. OQ protocol (executable test cases)
7. PQ outline
8. SOP — use of warehouse inventory system
9. Change control form
10. Intended use / known limitations
11. Access control matrix (default roles, SoD, 21 CFR 11.10(d)(g))
12. Material request and serialization (per-container serials, request→pick→issue)

## Default roles (seeded, system=true)

| Role | May |
|------|-----|
| System Administrator | Users, permission matrix, audit/access log, export, backup, view. Not receive/issue/QA disposition/destroy (SoD). |
| Warehouse Supervisor | Receive, move, issue, return, cycle count, reprint, hold, materials, user admin (cannot grant editPermissionMatrix), export, backup, view. Not QA disposition, destroy, or matrix edit. |
| Warehouse Operator | Receive, transfer, issue, return, cycle count, reprint, scan, view register/dashboard. |
| QA | Disposition, destroy, hold, materials, e-sign, reprint, view, export, backup. Not receive/issue/transfer (SoD). |
| QC | View, scan, cycle count, reprint. |
| Read-Only | View dashboard, register, scan, audit, inbox. No mutations. |
| Requester / Lab-Production | Submit material, submit request, confirm received, view, inbox. Not warehouse pick/receive/QA disposition. |

Admins may add custom roles. System roles cannot be deleted. Users cannot be deleted — only deactivated.

Receipts always default to Quarantine. No hard-delete of inventory (Issued / Consumed / Destroyed).

## Stack

Vite + React + TypeScript SPA, HashRouter, IndexedDB (idb), ExcelJS, JsBarcode, qrcode, Vitest.

Dates stored as ISO UTC; UI displays America/Los_Angeles.


## Later (not in v1.2)

Deferred: kitting / BOM issue, ASN / CSV inbound import, temperature excursion logs.
