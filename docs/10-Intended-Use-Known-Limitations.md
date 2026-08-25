# Intended Use and Known Limitations

| Field | Value |
|-------|-------|
| Document | IU-WH-INV-001 |
| Version | 1.2 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

## 1. Intended use

DOC-WH-INV-001 v1.2 is a **local browser application** intended to be the **system of record** for warehouse container inventory at [SITE] **only after** IQ/OQ/PQ are approved, users are trained, SOPs are effective, and demo accounts are removed.

It records identity, quantity, status, location, and QA disposition of GMP-relevant materials and supports barcode labeling and HID scanning.

Excel workbooks (in-app export and `exports/GMP_Warehouse_Inventory_Register_v1.1.xlsx` (structure; v1.2 live export adds Request Log and Material Submissions)) are **reporting templates / offline copies**, not Part 11 systems and not the system of record.

## 2. Not intended for

- Making GMP release decisions **before** validation
- Multi-site enterprise WMS / ERP replacement
- Environmental monitoring or qualified time-sync
- LIMS testing or CoA generation
- Legal electronic signature under a vendor certification
- Predicate rule replacement for paper if QA has not approved hybrid/electronic policy

## 3. Known limitations (must be in training)

1. Single-node: data is in one browser origin’s IndexedDB.
2. No certified NTP; timestamps follow the workstation clock (stored UTC, displayed America/Los_Angeles).
3. Passwords are PBKDF2-SHA-256 with lockout and complexity policy; still no MFA or SSO. No certified NTP. No WORM archive.
4. Audit trail is append-only in-app but not WORM; site data wipe or DevTools can destroy/alter the DB outside the app.
5. Backup/restore is a privileged user action, not an automatic validated archive.
6. Shared login cannot be fully prevented technically.
7. No Google Charts / CDN: barcodes are bundled, but printers/scanners are site devices.
8. Companion xlsx has seed data for structure/demo only — do not use as live inventory.
9. Application is **not validated as shipped**. Banner must remain until Quality removes it via change control after PQ.
10. Hosting (OS, browser, antivirus, USB policy) is not qualified by this package.

## 4. Residual regulatory statement

Technical controls were designed to **support** 21 CFR Part 11, 21 CFR 211.80–211.94, 211.142, 211.150, 211.180, 211.204, EU GMP Annex 11, ALCOA+, and GAMP 5. **Compliance is a site state**, not a property of the zip file.

## Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| QA | | | |
