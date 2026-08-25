# Functional Specification — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | FS-WH-INV-001 |
| Version | 1.3 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

Maps URS IDs to implemented functions in DOC-WH-INV-001 v1.3.

## 1. Architecture

- Client-only SPA (Vite/React/TS). Persistence: IndexedDB database `gmp-wh-inv`.
- Single inventory mutation module (`src/lib/inventory.ts`) — forms must not write GMP fields directly.
- Serial allocated **only on successful receive submit**.
- Dates stored ISO UTC; displayed America/Los_Angeles.

## 2. Functions

### F-01 Serial allocation (URS-01)
Format `WH-` + 4-digit UTC year + `-` + 6-digit sequence. Counter in `meta.serialCounter`. Collision check before persist. Barcode payload = serial.

### F-02 Goods receipt form (URS-02, 10, 13)
Creates **N** inventory rows (one serial per physical container) sharing `receiptBatchId`, status = Quarantine, movement RECEIVE, audit RECEIVE per serial (URS-21).

### F-03 QA disposition (URS-02, 09)
QA only. Release/Reject/Restricted. E-sign modal: password re-verify, printed name, userId, datetime UTC, meaning of signature, reason. Status derived from disposition.

### F-04 Transfer, Issue, Return, Hold, Cycle count, Destroy, Reprint (URS-03, 05, 10, 11)
Each is a dedicated route. Cycle count and transfer require reason. Issue calls FEFO (`src/lib/fefo.ts`): block non-Released and expired; warn + require override reason if earlier-expiry Released lot exists. Destroy is QA e-sign. Reprint audits PRINT_LABEL. No delete API on inventory.

### F-05 Audit trail (URS-06, 20)
`appendAudit` / `appendAuditSystem` only. Fields: id, timestampUtc, timestampLocal, userId, userName, role, action, recordId, field, oldValue, newValue, reasonForChange, meaningOfSignature. UI has no edit/delete. Idle timeout writes SESSION_TIMEOUT.

### F-06 Users and session (URS-07, 08, 16)
Roles from `roles` store + live permission matrix. PBKDF2-SHA-256 (legacy SHA-256 upgraded on login). Session in sessionStorage; idle 15 min writes SESSION_TIMEOUT. Access log store. Presentation `super` may overlay a role for UI; audit `userId` stays the authenticated user.

### F-07 Labels and scan (URS-14)
JsBarcode CODE128; qrcode library; 2x1 and 4x2 templates; print CSS hides chrome. Scan box: Enter → `/scan?serial=`.

### F-08 Material master (URS-19)
CRUD for QA or Supervisor; audit MATERIAL_CREATE/UPDATE.

### F-09 Dashboard and exports (URS-15, 17, 18)
Status counts, expired, 30/90 day, quarantine aging; KPI tiles filter register/queue (URS-27). ExcelJS reports with freeze, autofilter, footer DOC-WH-INV-001 / not validated / exported-by / ISO timestamp / app version. JSON backup of all stores.

### F-10 Document control banner (URS-18)
Every page and Excel footer: DOC-WH-INV-001 and validation disclaimer.


### F-11 Material requests (URS-22)
`submitRequest` auto-reserves FEFO Released stock. Warehouse `fulfillRequest` scan-picks then issues. Requester `confirmRequestReceipt`. Audit REQUEST_SUBMIT / REQUEST_RESERVE / REQUEST_PICK / REQUEST_UNPICK / REQUEST_ISSUE / REQUEST_CANCEL / REQUEST_REJECT / REQUEST_CLOSE.

### F-12 Material submissions (URS-23)
`submitMaterial` → QA/supervisor `approveMaterial` / `rejectMaterial`. Approval creates material master. Audit MATERIAL_SUBMIT / MATERIAL_APPROVE / MATERIAL_REJECT.

### F-13 Permission matrix (URS-16, 24)
Access page: users + matrix. Save requires e-sign. SoD: qaDisposition XOR receive, XOR fulfillRequest, XOR editPermissionMatrix; destroy requires eSign. Lockout prevention: at least one role keeps editPermissionMatrix and adminUsers. Audit MATRIX_SAVE per cell, ROLE_CREATE / ROLE_UPDATE.

### F-14 Samples and location barcodes (URS-25, 26)
`samplePull` creates child serial (`parentSerial`, recordKind sample/retain). Transfer accepts `LOC-…` barcodes after container scan.

## 3. Non-functions (explicit)

Not a validated hosting platform. Not NTP-certified. Not SSO. Not WORM archive. See doc 10.

## 4. Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| QA | | | |
