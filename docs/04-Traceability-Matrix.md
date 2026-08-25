# Traceability Matrix — URS → Function → OQ

| Field | Value |
|-------|-------|
| Document | TM-WH-INV-001 |
| Version | 1.1 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

| URS | Function (FS) | OQ test | PQ (if applicable) |
|-----|---------------|---------|--------------------|
| URS-01 Unique serial | F-01 | OQ-01 serial uniqueness/format | PQ-01 production receipts |
| URS-02 Quarantine default; QA-only release | F-02, F-03 | OQ-03 quarantine default; OQ-04 QA-only release | PQ-02 QA release of live lots |
| URS-03 No hard-delete | F-04 destroy/issue logical | OQ-04 / OQ-08 destruction | PQ-03 destruction event |
| URS-04 Controlled vocabularies | F-02 lookups | OQ-11 dropdowns / invalid reject | — |
| URS-05 FEFO + expiry block | F-04 issue | OQ-06 FEFO; OQ-07 expiry block | PQ-04 issue to a batch |
| URS-06 Audit trail | F-05 | OQ-05 audit immutability | PQ-05 audit review |
| URS-07 Users, timeout | F-06 | OQ-10 roles; idle (site) | PQ-06 unique logins |
| URS-08 Hashed passwords | F-06 | OQ-09 e-sign (re-entry); inspect no plaintext in backup JSON hashes | — |
| URS-09 E-sign content | F-03, destroy | OQ-09 e-sign | PQ-02 |
| URS-10 Dedicated forms | F-02–F-04 | OQ-03..OQ-08 via forms not table | PQ-01 |
| URS-11 Location fields | F-04 transfer | OQ-12 transfer | PQ-01 |
| URS-12 Storage conditions | F-02 | OQ-11 | — |
| URS-13 Identity fields | F-02 | OQ-03 receipt fields | PQ-01 |
| URS-14 Barcode/scan | F-07 | OQ-02 print/scan round-trip | PQ-07 warehouse scan |
| URS-15 Backup/Excel | F-09 | OQ-13 backup/restore | PQ-08 scheduled backup |
| URS-16 Roles | F-06 | OQ-10 | PQ-06 |
| URS-17 Dashboard | F-09 | OQ-14 dashboard counts | — |
| URS-18 Doc control banner | F-10 | OQ-15 banner/footer | — |
| URS-19 Material master | F-08 | OQ-16 material CRUD roles | — |
| URS-20 Reason for change | F-05 | OQ-05, OQ-08, cycle count | — |

Blank approval:

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| QA | | | |
