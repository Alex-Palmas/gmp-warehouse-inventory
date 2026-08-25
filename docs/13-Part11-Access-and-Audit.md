# 21 CFR Part 11 — Access and Audit Mapping (DOC-WH-INV-001 v1.3)

| Field | Value |
|-------|-------|
| Document | P11-WH-INV-001 |
| Version | 1.3 (draft template) |
| Related | DOC-WH-INV-001 v1.3 |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

This note maps 21 CFR 11.10(d), 11.10(e), 11.10(g), 11.50, and 11.70 to functions in this application. It is **not** a vendor certification. Residual gaps (SSO, NTP, WORM) remain — see README.

## 11.10(d) Limiting system access to authorized individuals

| Control | Function / data |
|---------|-----------------|
| Unique user IDs, never reused; deactivate not delete | `createUser`, `updateUser` (`src/lib/auth.ts`) |
| Password policy, history, 90-day expiry, PBKDF2 | `passwordPolicy.ts`, `crypto.ts` |
| 5-failure lockout 15 min; admin unlock | `applyFailedLogin`, `unlockUser` (cap `unlockUser`) |
| Session idle 15 min | `loadSession` / Layout timer |
| Login events in access log **and** audit trail | `login` writes LOGIN / LOGIN_FAIL / LOCKOUT via `appendAudit` / `appendAuditSystem` |

## 11.10(g) Authority checks to ensure only authorized individuals use the system

Every user-facing **action** is its own capability checkbox on Access → Permission matrix. Authorization is `assertCapability(session, cap)` **before** the write, not the role display name.

| Action | Capability | Default ON |
|--------|------------|------------|
| Approve material submission | `approveMaterial` | QA, supervisor |
| Reject material submission | `rejectMaterial` | QA, supervisor |
| Cancel material request | `cancelRequest` | requester, supervisor |
| Reject material request | `rejectRequest` | operator (fulfill), supervisor |
| Confirm request receipt | `confirmRequestReceipt` | roles with `submitRequest` |
| Unlock user | `unlockUser` | sysadmin, supervisor (`adminUsers` roles) |
| Reset user password | `resetUserPassword` | sysadmin, supervisor |
| Create custom role | `createRole` | sysadmin (`editPermissionMatrix` only) |
| Export audit CSV | `exportAudit` | roles with `viewAudit` |

Existing caps (`receive`, `issue`, `qaDisposition`, `adminUsers`, …) are unchanged. `hydrateMatrixDocument` fills newly added caps from defaults for existing IndexedDB matrices.

SoD still blocks save of `fulfillRequest` + `qaDisposition` on the same role, and lockout prevention keeps at least one `editPermissionMatrix` and one `adminUsers`.

## 11.10(e) Audit trail

`src/lib/audit.ts` is **add-only** (`appendAudit`, `appendAuditSystem`, `listAudit`, `listAuditForRecord`). No update/delete API.

Rule: exported mutations in `inventory.ts`, `requests.ts`, `submissions.ts`, `auth.ts` that `db.add`/`db.put` records call `appendAudit` in the same function after the write.

| Event | Action code | Notes |
|-------|-------------|--------|
| Goods receipt, transfer, issue, return, cycle count, hold, destroy, sample | RECEIVE / TRANSFER / ISSUE / … | One row per serial / field |
| Request submit / pick / unpick / issue / cancel / reject / confirm | REQUEST_* | `removePick` writes REQUEST_UNPICK |
| Material submit / approve / reject | MATERIAL_* | |
| User create / update / unlock / password change or reset | USER_* / USER_UNLOCK / PASSWORD_CHANGE / PASSWORD_RESET | |
| LOGIN / LOGOUT / LOGIN_FAIL / LOCKOUT | same | Fail/lockout use `appendAuditSystem` (still writes `userId`) |
| Matrix save (per cell), role create | MATRIX_SAVE / ROLE_CREATE | |
| Label reprint, Excel export, audit CSV, backup/restore | PRINT_LABEL / EXPORT / BACKUP / RESTORE | |
| Barcode scan of a serial | SCAN | `recordId` = serial; location barcodes skipped |
| Inbox mark-read | — | Not a GMP record; no audit |
| First-boot seed | — | System seed; documented, not audited |

Fields: UTC, local (America/Los_Angeles), userId, userName, action, recordId, field, oldValue, newValue, reasonForChange, meaningOfSignature. Reason is required for corrections (cycle count, qty adjust, cancel, reject, role change, deactivate).

Audit UI (`#/audit`): filters user / action / record / date from-to as query params (deep-linkable), newest first, CSV export (`exportAudit` or `exportReports`). Record detail lists `listAuditForRecord`.

## 11.50 / 11.70 Signature manifestations and linking

QA disposition, destruction, and permission-matrix save require password re-challenge (`ESignModal`). Captured: printed name, user ID, signed-at UTC, meaning of signature. The meaning is stored on the audit row and on the signed record (`qaEsign`, `destructionEsign`, matrix `meaningOfSignature`), linking the signature to the record (11.70).

This is **not** a certified biometric/token signature.

## Residual gaps (honest)

No SSO/AD, no MFA, no qualified NTP, no WORM / independent archive, no vendor Part 11 letter. IndexedDB can be wiped with site data. See README.

## Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| Quality Assurance | | | |
