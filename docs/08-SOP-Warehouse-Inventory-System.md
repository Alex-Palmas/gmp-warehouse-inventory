# SOP Template — Use of the Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | SOP-WH-INV-001 |
| Version | 1.0 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not effective** until QA approves and training complete |

## 1. Purpose

Define how personnel at [SITE] use DOC-WH-INV-001 as the warehouse inventory system of record **after** IQ/OQ/PQ approval.

## 2. Scope

Warehouse, QA, and material-handling staff. Does not replace sampling SOPs, CoA review SOPs, or destruction SOPs; this SOP covers **system use**.

## 3. Responsibilities

- Warehouse Operator: receive, move, issue, return, cycle count, print labels
- Warehouse Supervisor: user admin, hold, backup, material master
- QA: disposition, destruction e-sign, material master, audit review
- Read-Only: view
- IT/CSV: installation, backup target, change control
- **All: unique personal login; never share passwords**

## 4. Procedure

### 4.1 Login
Use assigned User ID. If demo accounts exist, Supervisor deactivates them. Lock the screen when leaving. Session times out at 15 minutes idle.

### 4.2 Goods receipt
1. Verify physical identity vs delivery note and CoA.
2. Complete Goods Receipt form (do not skip CoA, lots, expiry, storage condition, location).
3. Status will be Quarantine. Print and apply label to the container.
4. Place in designated quarantine location.

### 4.3 Sampling
If sampling required, record linked sample IDs. Sampling execution is per LIMS/SOP-[SITE].

### 4.4 QA disposition
QA reviews CoA/LIMS. On the QA Disposition form, select Release / Reject / Restricted, re-enter password, confirm meaning of signature, record reason. Do not ask warehouse to "just mark it released".

### 4.5 Issue / FEFO
Issue only Released, non-expired stock. If FEFO warning appears, do not override without documented process need and Supervisor/QA approval per [SITE] policy. Expired material is never issued.

### 4.6 Transfer, hold, cycle count
Reason for change is mandatory. Cycle count discrepancies escalate per [SITE] inventory SOP.

### 4.7 Destruction
QA e-signs. Physical destruction per separate SOP. System status becomes Destroyed; do not delete the record.

### 4.8 Label reprint
Reprint only if label is damaged/illegible. Confirm serial still matches container before applying.

### 4.9 Scan
Scan serial at receipt put-away, issue, and (if required) shipping. If scan does not match expected material, **stop**.

### 4.10 Backup
Supervisor or QA exports JSON backup to [CONTROLLED PATH] on schedule: [DAILY/WEEKLY]. Verify file opens. Excel reports are **not** the system of record.

### 4.11 Corrections
Never hide errors. Use the appropriate form; provide reason for change. Audit trail is not editable.

## 5. Training

Role-based. Record in LMS. Retrain on version change.

## 6. Records

IndexedDB content, JSON backups, Excel reports, this SOP, IQ/OQ/PQ packages. Retention: [SITE] per 211.180 (e.g. 1 year after expiry of related lots or as Quality defines).

## 7. References

URS/FS/RA/OQ; 21 CFR 11; 211.80–211.94; 211.142; 211.150; 211.180; 211.204; EU GMP Annex 11.

## Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| Warehouse manager | | | |
| QA | | | |
