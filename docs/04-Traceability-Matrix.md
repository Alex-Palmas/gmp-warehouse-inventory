# Traceability Matrix — URS → Function → OQ

| Field | Value |
|-------|-------|
| Document | TM-WH-INV-001 |
| Version | 1.3 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |
| Software | DOC-WH-INV-001 v1.3 |

Every URS row must have an FS function and an OQ test. Automated vitest (`src/tests/`) is supporting evidence, not a substitute for executed OQ.

| URS | Function (FS) | OQ test | PQ (if applicable) | Automated evidence |
|-----|---------------|---------|--------------------|--------------------|
| URS-01 Unique serial | F-01 | OQ-01 serial uniqueness/format | PQ-01 production receipts | `serial.test.ts`, `serialization.test.ts` |
| URS-02 Quarantine default; QA-only release | F-02, F-03 | OQ-03 quarantine default; OQ-04 QA-only release | PQ-02 QA release of live lots | `workflow.test.ts`, `access.test.ts` |
| URS-03 No hard-delete | F-04 destroy/issue logical | OQ-08 destruction | PQ-03 destruction event | `workflow.test.ts` |
| URS-04 Controlled vocabularies | F-02 lookups | OQ-11 dropdowns / invalid reject | — | — |
| URS-05 FEFO + expiry block | F-04 issue; F-11 request reserve | OQ-06 FEFO; OQ-07 expiry block | PQ-04 issue to a batch | `fefo.test.ts` |
| URS-06 Audit trail (incl. role) | F-05 | OQ-05 immutability; OQ-27 receipt audit; OQ-28 request audit | PQ-05 audit review | `audit.test.ts`, `cfrAccessAudit.test.ts` |
| URS-07 Users, timeout, lockout | F-06 | OQ-10 roles; OQ-17 lockout; idle SESSION_TIMEOUT | PQ-06 unique logins | `access.test.ts` |
| URS-08 Hashed passwords | F-06 | OQ-09 e-sign (re-entry); inspect hashes in backup JSON | — | `cfrAccessAudit.test.ts` password change |
| URS-09 E-sign content | F-03, F-04 destroy, F-13 matrix | OQ-08, OQ-09, OQ-18 | PQ-02 | `access.test.ts` SoD own-receipt |
| URS-10 Dedicated forms | F-02–F-04, F-11, F-12 | OQ-03..OQ-08 via forms not table | PQ-01 | — |
| URS-11 Location fields | F-04 transfer | OQ-12 transfer | PQ-01 | — |
| URS-12 Storage conditions | F-02 | OQ-11 | — | — |
| URS-13 Identity fields | F-02 | OQ-03 receipt fields | PQ-01 | — |
| URS-14 Barcode/scan | F-07 | OQ-02 print/scan round-trip | PQ-07 warehouse scan | `serial.test.ts` |
| URS-15 Backup/Excel | F-09 | OQ-13 backup/restore | PQ-08 scheduled backup | — |
| URS-16 Roles / matrix | F-06, F-13 | OQ-10, OQ-18, OQ-19, OQ-26 | PQ-06 | `access.test.ts`, `cfrAccessAudit.test.ts` |
| URS-17 Dashboard | F-09 | OQ-14 dashboard counts | — | `kpiFilter.test.ts` |
| URS-18 Doc control banner | F-10 | OQ-15 banner/footer | — | — |
| URS-19 Material master | F-08 | OQ-16 material CRUD roles | — | — |
| URS-20 Reason for change | F-05 | OQ-05, OQ-08, cycle count | — | `cfrAccessAudit.test.ts` |
| URS-21 Per-container serials + receipt batch | F-01, F-02 | OQ-21 | PQ-01 | `serialization.test.ts` |
| URS-22 Material request FEFO reserve → pick → issue → confirm | F-11 | OQ-22, OQ-28 | PQ-04 | `workflow.test.ts`, `cfrAccessAudit.test.ts` |
| URS-23 Submit / approve / reject material | F-12 | OQ-25 | — | `cfrAccessAudit.test.ts` approveMaterial |
| URS-24 Split capabilities + e-signed matrix save + SoD | F-13 | OQ-18, OQ-19, OQ-20, OQ-26 | PQ-06 | `access.test.ts` |
| URS-25 Sample / retain child serial | F-14 | OQ-23 | — | `serialization.test.ts` |
| URS-26 Location barcode putaway | F-14 | OQ-24 | PQ-07 | — |
| URS-27 Clickable dashboard KPIs | F-09 | OQ-14 | — | `kpiFilter.test.ts` |
| URS-28 CoA / certificate attachments | F-02 receipt; attachments store | — | — | `attachments.test.ts` |
| URS-29 Material Transfer e-sign A/B/C | F-11 request / MTF | — | — | `mtf.test.ts`, `serialization.test.ts` |

Part 11 mapping detail: `docs/13-Part11-Access-and-Audit.md`. Access defaults: `docs/11-Access-Control-Matrix.md`. Request/serialization: `docs/12-Material-Request-and-Serialization.md`.

Blank approval:

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| QA | | | |
