# Performance Qualification Outline — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | PQ-WH-INV-001 |
| Version | 1.0 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** — expand into a full protocol with live SOPs before execution |

PQ demonstrates the system **in the intended operating environment** with trained users and site SOPs, using representative (or actual) materials. IQ and OQ must be complete.

## 1. Objectives

- Confirm end-to-end warehouse process: receive → quarantine → sample (if required, off-system LIMS) → QA release → storage → FEFO issue → reconciliation.
- Confirm labels are usable on the warehouse floor with the site scanner/printer.
- Confirm backup job actually runs to the controlled location.
- Confirm users do not share accounts; demo users deactivated.

## 2. Prerequisites

- Approved SOP-WH-INV-001 (doc 08)
- Training records for Operator, Supervisor, QA, Read-Only
- Demo passwords changed / demo users deactivated
- Label stock 2x1 and/or 4x2 and qualified printer
- HID scanner qualified in IQ
- Change control for go-live

## 3. Suggested scenarios (site to add lot IDs)

| ID | Scenario | Acceptance | Trace |
|----|----------|------------|-------|
| PQ-01 | Receive ≥3 live containers (API, excipient, packaging) into Quarantine; print and apply labels | Serials unique; labels scannable; status Quarantine | URS-01, 02, 14 |
| PQ-02 | QA release of those lots against CoA / LIMS (attach CoA numbers) | E-sign present; status Released | URS-09 |
| PQ-03 | One rejection or restriction (or simulated reject lot) | Cannot issue; destruction or return-to-vendor per SOP | URS-02, 03 |
| PQ-04 | Issue to a manufacturing order using FEFO | Earliest expiry used or override documented | URS-05 |
| PQ-05 | QA review of audit trail for PQ week | No gaps vs paper goods-receipt if dual running | URS-06 |
| PQ-06 | Unique logins; attempt shared use is stopped by SOP | Access log shows named users | URS-07 |
| PQ-07 | 10 consecutive scans from floor | 10/10 correct records | URS-14 |
| PQ-08 | Scheduled backup restore test in a **non-prod** browser profile | Restore succeeds; production origin untouched | URS-15 |

## 4. Dual running (recommended)

Run paper or previous register in parallel for [N] receipts. Discrepancy limit: 0 identity errors. Duration: [SITE] e.g. 2 weeks or 20 receipts, whichever greater.

## 5. PQ report

Summarize deviations, training, go-live recommendation. Quality Unit approves before GMP decisions are made **in this system**.

## Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| QA | | | |
| Warehouse | | | |
