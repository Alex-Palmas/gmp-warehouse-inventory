# User Requirements Specification — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | URS-WH-INV-001 |
| Version | 1.3 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** — complete, review, and approve per site document control |

Related application: DOC-WH-INV-001 v1.3. This URS is a **template**. Do not treat it as pre-approved.

## 1. Purpose

Specify user requirements for an electronic warehouse inventory register used as the system of record for GMP materials, packaging components, intermediates, finished product, samples, retain samples, reference standards, and consumables at [SITE].

## 2. Scope

In: receipt, quarantine, QA disposition, storage location, issue, return, hold, cycle count, destruction, labeling/barcodes, audit trail, user access, backup, reporting.

Out: LIMS testing, ERP purchasing, temperature-monitoring historians, warehouse WMS robotics, validated hosting infrastructure (site-owned).

## 3. Regulatory mapping (requirement → citation)

Each URS ID must be traced in the matrix (doc 04) and tested in OQ (doc 06).

| URS | Requirement | 21 CFR Part 11 | 21 CFR 211 | Annex 11 | ALCOA+ |
|-----|-------------|----------------|------------|----------|--------|
| URS-01 | Unique never-reused container serial WH-YYYY-NNNNNN as barcode payload | 11.10(b) accurate copies; 11.10(e) record | 211.80 identity; 211.82 receipt; 211.142 storage | 11.4, 11.7 | Consistent, Complete |
| URS-02 | Receipts default to Quarantine; only QA may Release/Reject/Restricted/Destroy | 11.10(g) authority checks | 211.84 testing/release; 211.89 rejected; 211.80(d) quarantine | 11.12 security | Attributable |
| URS-03 | No hard-delete of inventory; logical Issued/Consumed/Destroyed | 11.10(c) protection of records | 211.180 retention; 211.204 returns | 11.7, 11.17 | Enduring |
| URS-04 | Controlled vocabularies for status, UOM, storage, item type | 11.10(f) operational system checks | 211.80 labeling; 211.86 use | 11.6 accuracy | Accurate |
| URS-05 | FEFO: warn if not earliest-expiry Released lot; block expired and non-Released issue | 11.10(f) checks | 211.86 FIFO/FEFO use; 211.87 retesting; 211.150 distribution | 11.6 | Accurate |
| URS-06 | Append-only audit trail: UTC, local, userId, userName, **role**, action, recordId, field, old, new, reasonForChange, meaningOfSignature. No edit/delete API. | 11.10(e) audit trail | 211.180, 211.188, 211.194 as applicable to records | 11.9 audit trails | Contemporaneous, Complete |
| URS-07 | Unique user ID, full name, role; no shared accounts (SOP); idle timeout ~15 min | 11.10(d)(g); 11.300 | 211.68 automatic equipment | 11.12 | Attributable |
| URS-08 | Passwords hashed, never plaintext; e-sign re-enters password | 11.10(d); 11.50; 11.70; 11.200 | — | 11.12, 11.14 | Attributable |
| URS-09 | E-sign on QA disposition and Destruction captures printed name, ID, datetime, meaning | 11.50, 11.70, 11.200 | 211.84 release; 211.89 | 11.14 electronic signature | Attributable |
| URS-10 | Dedicated forms only (no raw table edit of GMP fields) | 11.10(f) | 211.68; 211.100 | 11.6 | Original |
| URS-11 | Location: Site, Building, Room, Rack, Shelf, Bin | — | 211.80; 211.82; 211.142 | — | Complete |
| URS-12 | Storage condition controlled list including CRT, 2–8 °C, −20 °C, −80 °C, humidity, light, flammable | — | 211.80(b); 211.142 | — | Accurate |
| URS-13 | Identity fields: material, grade, pharmacopeia, mfr/supplier lots, PO, CoA, internal lot, qty, UOM, DOM, receipt, expiry, retest, sampling, comments | — | 211.80–211.94; 211.184 | 11.4 | Complete |
| URS-14 | Barcode Code 128 of serial; QR serial\|lot\|expiry\|status; printable 2x1 and 4x2; HID scan lookup | 11.10(b) | 211.80 identity; 211.82 | 11.4 | Consistent |
| URS-15 | Backup/restore of all stores; Excel reports with document-control footer | 11.10(b)(c) | 211.180 | 11.7, 11.16 | Enduring, Available |
| URS-16 | Seeded roles (sysadmin, supervisor, operator, QA, QC, requester, read-only) plus admin-editable matrix | 11.10(g) | 211.25; 211.68 | 11.12 | Attributable |
| URS-17 | Dashboard: counts by status, expired, 30/90 day expiry, quarantine aging | — | 211.142; 211.150 | 11.6 | Available |
| URS-18 | Document-control footer DOC-WH-INV-001 and validation banner on screens and exports | 11.10(k) | 211.100; 211.180 | 11.4 | Consistent |
| URS-19 | Material master CRUD limited to QA or Supervisor | 11.10(g) | 211.80; 211.184 | 11.12 | Attributable |
| URS-20 | Corrections require reasonForChange | 11.10(e) | 211.68; 211.194 | 11.9 | Contemporaneous |
| URS-21 | Receipt of N physical containers creates N unique serials sharing one receiptBatchId (RCV-YYYY-NNNNNN) | 11.10(b) | 211.80(d) each-container identity | 11.4 | Complete |
| URS-22 | Lab/production submit material requests; FEFO auto-reserve; warehouse scan-pick and issue; requester confirms receipt | 11.10(g) | 211.150 distribution; 211.86 use | 11.6 | Attributable |
| URS-23 | New-material submissions require approve/reject (capability-gated) before receipt | 11.10(g) | 211.80; 211.184 | 11.12 | Attributable |
| URS-24 | Permission matrix is live, e-signed on save; every mutation has its own capability; SoD rules block save | 11.10(d)(g) | 211.25; 211.68 | 11.12 | Attributable |
| URS-25 | Sample/retain pull creates a child serial linked to parent | 11.10(e) | 211.84 sampling; 211.170 reserve samples | 11.4 | Complete |
| URS-26 | Location barcodes (LOC-…) for putaway; scan serial then location | — | 211.80; 211.142 | — | Consistent |
| URS-27 | Dashboard KPI counts are clickable and filter the register / request queue | — | 211.142 | 11.6 | Available |
| URS-28 | Optional CoA/certificate attachments per serial and receipt batch; append-only; IndexedDB is not a DMS | 11.10(b)(e) | 211.80; 211.184 | 11.7 | Complete, Enduring |
| URS-29 | Material Transfer e-sign workflow (requestor → supervisor → QA when cell bank/quarantine → warehouse issue → receiver qty received); FEFO reserve on Approved | 11.10(g); 11.50 | 211.150; 211.80(d) | 11.12, 11.14 | Attributable |
| URS-30 | Validation role may run in-app sandbox self-validation that executes an automated OQ protocol against a separate IndexedDB and exports evidence. Not a substitute for executed IQ/OQ/PQ; must not touch production lots; app remains not validated as shipped. | 11.10(k) documentation | — | 11.4 | Available |

**211.80–211.94** (receipt, storage, testing, rejected, retesting) are covered by URS-02, 04, 11, 12, 13. **211.142** warehousing by URS-11, 12, 17. **211.150** distribution/FEFO by URS-05. **211.180** record retention by URS-03, 06, 15. **211.204** returned goods by Return-to-stock form (URS-10/03).

## 4. Assumptions and site responsibilities

- Site provides qualified workstation, qualified time source if required, SOPs, training, and IQ/OQ/PQ.
- Application as shipped is **not validated**.
- [SITE] Quality Unit approves this URS before OQ execution.

## 5. Approval (blank)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | [OWNER] | [DATE] | |
| System owner | | | |
| Quality Assurance | | | |
