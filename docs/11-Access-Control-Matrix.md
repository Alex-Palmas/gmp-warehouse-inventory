# Access Control Matrix — DOC-WH-INV-001 v1.2

| Field | Value |
|-------|-------|
| Document | AC-WH-INV-001 |
| Version | 1.2 (draft template) |
| Related | DOC-WH-INV-001 v1.2 |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

This document describes the **default** role/capability matrix shipped with the application, segregation-of-duties (SoD) rules, how administrators change the matrix, and mapping to 21 CFR Part 11.10(d)(g) and EU GMP Annex 11 §12.

The live matrix is **data** in IndexedDB (`meta.permissionMatrix`), not compiled role names. Authorization is `hasCapability(session, capability)` against the live document.

## 1. Unique users (11.10(d), 11.300; Annex 11.12)

- User IDs are unique forever. Create is rejected if the ID exists, including deactivated accounts. Users are never deleted — only deactivated.
- Role assignment changes are audited (old role, new role) and require a reason.
- Last login, failed attempts, lockout, password-changed time, must-change-password, and last-4 password history are stored.
- Login: 5 failed attempts lock the account 15 minutes (or until admin unlock). Unknown user and bad password return the same message. LOGIN_FAIL and LOCKOUT are written to the access log. Admin unlock is audited.
- Password policy: minimum 12 characters; upper, lower, digit, special; not equal to user ID; not in last 4 hashes; 90-day expiry; first login / temp password must be changed before warehouse activity.
- Hash: PBKDF2-SHA-256, 100000 iterations, 16-byte salt, Web Crypto. Legacy SHA-256(salt:password) still verifies once and is upgraded on login.
- Session: 15-minute idle timeout in sessionStorage (one tab). Concurrent browsers are not technically blocked.

## 2. Capabilities (closed list)

View: viewDashboard, viewRegister, viewAudit, viewAccessLog, scanLookup, viewInbox

Inventory: receive, transfer, issue, returnToStock, cycleCount, reprintLabel

Requests & sampling: submitMaterial, submitRequest, fulfillRequest, samplePull

QA: hold, qaDisposition, destroy, eSign

Admin: adminMaterials, adminUsers, editPermissionMatrix, backupRestore, exportReports

## 3. Default roles (system=true; cannot delete)

| Role ID | Name | Default capabilities (summary) |
|---------|------|--------------------------------|
| sysadmin | System Administrator | adminUsers, editPermissionMatrix, viewAudit, viewAccessLog, exportReports, backupRestore, viewDashboard, viewRegister, scanLookup. **Not** receive / issue / qaDisposition / destroy. |
| supervisor | Warehouse Supervisor | Warehouse mutations, hold, adminMaterials, adminUsers (cannot assign a role that has editPermissionMatrix), export, backup, view all. **Not** qaDisposition, destroy, editPermissionMatrix. |
| operator | Warehouse Operator | receive, transfer, issue, returnToStock, cycleCount, reprintLabel, scanLookup, viewDashboard, viewRegister. **Not** hold, QA, destroy, user admin, matrix. |
| qa | QA | qaDisposition, destroy, hold, adminMaterials, eSign, reprint, view all, export, backup. **Not** receive / issue / transfer (SoD). |
| qc | QC | viewDashboard, viewRegister, scanLookup, cycleCount, reprintLabel. |
| readonly | Read-Only | viewDashboard, viewRegister, scanLookup, viewAudit, viewInbox. No mutations. |
| requester | Requester / Lab-Production | submitMaterial, submitRequest, viewDashboard, viewRegister, scanLookup, viewInbox. **Not** receive / fulfillRequest / qaDisposition. |
| super | Presentation Superuser | **All capabilities.** Demo / walkthrough only. Matrix SoD and own-receipt SoD are waived for this role. Not for GMP use. Seeded user `super` / `Super123!xx` (no first-login password change). |

Custom roles (e.g. Shipping, Night Shift) may be added by a matrix editor. They cannot reuse a system role ID. Custom roles may be deactivated only when no users remain assigned.

## 4. Segregation of duties (21 CFR 211 / data integrity)

Configurable rules stored with the matrix. **Defaults ON.** Violations **block save** unless the admin records a documented SoD waiver (still warned).

1. **qaDisposition XOR receive** on the same role. Default QA role therefore cannot receive/issue/transfer. Intended path: receive as `wh`, release as `qa`.
2. **destroy requires eSign**.
3. **editPermissionMatrix XOR qaDisposition** on the same role.
4. **qaDisposition XOR fulfillRequest** on the same role (QA does not pick/issue against requests).
4. **Own-receipt:** a user cannot e-sign a disposition on a record they created (`createdBy === session.userId`), even if the role has both capabilities. Enforced in QA disposition.

Lockout prevention (always enforced, not waivable): at least one role must retain `editPermissionMatrix`; at least one role must retain `adminUsers`.

## 5. How administrators change the matrix

1. Log in as a user whose role has `editPermissionMatrix` (seeded: `sysadmin`).
2. Open **Access** → Permission matrix. Toggle cells. SoD warnings update live.
3. **Save** opens the e-sign modal. Meaning default: `I authorize this access control configuration`. Reason for change is required.
4. Each save increments matrix version, appends `permissionMatrixHistory`, and writes one audit row per changed cell (old true/false, new true/false).
5. Users with `adminUsers` but not `editPermissionMatrix` (seeded: `admin` supervisor) may create/deactivate/unlock users and assign roles **except** roles that grant `editPermissionMatrix`. They see the matrix **read-only**.

Production **MUST** change all demo passwords before any GMP use.

## 6. Regulatory mapping

| Control | Citation |
|---------|----------|
| Unique user IDs, no reuse, deactivate not delete | 21 CFR 11.10(d); 11.300; Annex 11.12 |
| Authority checks via live matrix; nav and routes gated by capability | 21 CFR 11.10(g); Annex 11.12 |
| Password hash, policy, history, expiry, lockout | 21 CFR 11.10(d); 11.300 |
| E-sign on matrix save and QA/destroy | 21 CFR 11.50, 11.70, 11.200 |
| Audit of role changes and matrix cell changes | 21 CFR 11.10(e); Annex 11.9 |
| SoD receive vs disposition | 21 CFR 211.84 / 211.80; data integrity |

## 7. Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| System owner | | | |
| Quality Assurance | | | |
