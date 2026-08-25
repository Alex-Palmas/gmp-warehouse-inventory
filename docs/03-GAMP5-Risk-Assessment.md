# GAMP 5 Risk Assessment — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | RA-WH-INV-001 |
| Version | 1.0 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |
| GAMP category (suggested) | Category 5 (custom application) unless site re-classifies |

Severity (S) 1–5, Probability (P) 1–5, Detectability (D) 1–5 (1 = easily detected). RPN = S×P×D. Thresholds: [SITE] to set; suggested ≥40 high.

## Hazard 1 — Mix-up of containers / wrong identity

| | |
|--|--|
| Scenario | Operator issues or labels the wrong container; serial reused; barcode encodes wrong payload |
| S | 5 (patient/product mix-up) |
| P (uncontrolled) | 4 |
| D (uncontrolled) | 4 |
| RPN uncontrolled | 80 |
| Controls in software | Unique serial never reused; barcode = serial; QR includes lot/expiry/status; dedicated receipt form; scan lookup; no raw table edit |
| Residual | Wrong material selected on receipt still possible — mitigate by two-person verification SOP, CoA check, sampling |
| OQ | Serial uniqueness, barcode print/scan round-trip |
| SOP | Identity check at receipt and issue |

## Hazard 2 — Expired material issued to production

| | |
|--|--|
| Scenario | Expired or soon-to-expire lot issued; FEFO ignored |
| S | 5 |
| P | 4 |
| D | 3 |
| RPN uncontrolled | 60 |
| Controls | Issue blocked if expired or not Released; FEFO warning + override reason required and audited; dashboard 30/90 day |
| Residual | Override can still be abused; site SOP must restrict FEFO override and QA review of audit |
| OQ | Expiry block; FEFO warning |

## Hazard 3 — Unauthorized release from quarantine

| | |
|--|--|
| Scenario | Warehouse operator changes status to Released without QA |
| S | 5 |
| P | 3 |
| D | 3 |
| RPN uncontrolled | 45 |
| Controls | Role check in inventory module; only QA disposition function; e-sign password re-entry; Read-Only cannot mutate; receipts default Quarantine |
| Residual | Shared login as QA; stolen password — SOP + unique IDs + timeout |
| OQ | Operator cannot release; QA-only destroy |

## Hazard 4 — Audit trail tampering

| | |
|--|--|
| Scenario | User edits/deletes audit rows to hide a bad issue |
| S | 4 |
| P | 3 |
| D | 5 (if no independent copy) |
| RPN uncontrolled | 60 |
| Controls | No update/delete API; UI has no edit; IndexedDB add-only for audit |
| Residual | Browser DevTools / site-data wipe / file restore of a sanitized backup. **High residual.** Site must: scheduled JSON backup to controlled file share, hash/checksum of backups, restrict who can restore, periodic audit review. Not WORM. |
| OQ | Audit immutability (API/module); backup/restore |

## Hazard 5 — Shared login / wrong attribution

| | |
|--|--|
| Scenario | Team uses `qa` / demo password; e-sign not attributable |
| S | 4 |
| P | 5 (demo accounts exist) |
| D | 2 |
| RPN uncontrolled | 40 |
| Controls | Unique userId; full name on audit and e-sign; 15 min idle; access log; demo passwords documented as must-change |
| Residual | Application cannot prove a human is not sharing a password. SOP + training + deactivate demo accounts after PQ. |
| OQ | Roles; e-sign; login fail logging |

## Other hazards (summary)

| ID | Hazard | Key control |
|----|--------|-------------|
| H6 | Cycle-count qty fraud | Reason required; audit old/new qty |
| H7 | Destruction without QA | QA e-sign only |
| H8 | Restore of stale backup overwrites truth | Restore audited; dual control SOP |
| H9 | Clock skew | Residual — site qualify time if needed |
| H10 | Loss of IndexedDB | Backup SOP |

## Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| Quality Risk Management | | | |
| QA | | | |
