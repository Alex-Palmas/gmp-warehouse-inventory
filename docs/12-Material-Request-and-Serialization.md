# Material request, per-container serialization, and warehouse efficiency — DOC-WH-INV-001 v1.2

| Field | Value |
|-------|-------|
| Document | FS-WH-INV-012 |
| Version | 1.2 (draft template) |
| Related | DOC-WH-INV-001 v1.2 |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved** |

Technical controls only. Not a validation claim.

## 1. Per-container serialization (21 CFR 211.80(d) stricter grouping)

- Each physical unit (vial, bottle, drum, bag, …) is allocated its **own** unique serial `WH-YYYY-NNNNNN`.
- All N serials in one goods receipt share `receiptBatchId` `RCV-YYYY-NNNNNN` (GS1-style parent/child aggregation).
- Fields: `containerType`, `containerIndex` (1 of N), `qtyPerContainer`, `currentQty`, `recordKind` (`container` \| `sample` \| `retain`), optional `parentSerial`.
- Example: 24 vials × 10 mL → 24 serials, one receipt batch. Never one serial covering 24 vials.
- Vial/bottle typically `qtyPerContainer = 1`. Drum/bag carry fill quantity. Whole-unit issue sets status Issued; partial drum issue reduces `currentQty` (Consumed at 0 after a draw-down).
- Labels: Code 128 of the **container serial**. QR `serial|lot|expiry|status|containerType`. Print all N (page-break) or selected; optional batch summary label.
- Register groups by `receiptBatchId` (expandable). Search still finds an individual serial.
- Migration of pre-v1.2 rows: `receiptBatchId = serial`, `containerIndex = 1`, `recordKind = container`.

## 2. QA disposition and sampling (211.82 / 211.84)

- Receipts always enter **Quarantine**.
- Default QA Release: one e-sign releases all Quarantine **sibling containers** in the receipt batch. Audit each serial.
- Single-container Reject / Restricted is allowed (damage).
- `samplePull` (qa, qc): child serial `recordKind` sample|retain, `parentSerial` set, parent `currentQty` decremented, own barcode.

## 3. Submit new material

Capability `submitMaterial` (requester, operator, supervisor, qa, qc).

Submitted → Approved (QA or supervisor writes Material Master) or Rejected (reason). Inbox notifies the requester. Goods receipt dropdown lists **active approved** Material Master only.

## 4. Request → pick → issue (211.142 / 211.150 / EU GMP requisition)

Primary issue path. Direct Issue remains for supervisor/operator **emergency**.

1. `submitRequest` (requester, operator, supervisor, qa, qc): material, qty+UOM, to-location, classification, intended use, requestor e-sign. Creates `MR-YYYY-NNNNNN` at **Pending Supervisor**. Warn if insufficient Released FEFO stock; still allow submit. **Do not reserve yet.**
2. Supervisor e-sign (`approveRequest`) → `Approved` (or `Pending QA` if cell bank/quarantine). QA e-sign (`qaDisposition`) → `Approved`. **FEFO auto-reserve on Approved** (`reservedForRequestId`, `reservedQty`). A second approved transfer cannot claim the same serial. Reservation is released on cancel/reject (and when fully issued).
3. `fulfillRequest` (operator, supervisor only; **not** QA — SoD): warehouse queue is Approved / Picking / Partially Issued only. FEFO proposal sorted by **location walk path**. Pick by scanning serials. Wrong material / status / expired → error beep. Quarantine pick only after QA e-sign on a cell-bank transfer.
4. Confirm issue: MM comments or N/A + MM e-sign; picked serials Issued; lot/expiry/location from scanned serials; requester inbox “ready”.
5. Requester confirms qty received + e-sign → Closed (chain of custody).
6. Cancel from Pending Supervisor / Pending QA / Submitted; warehouse reject with reason.

See §10 for the paper MTF A/B/C mapping.

Distribution records name which **serials** left, to whom, when, for which request.

## 5. Scan, putaway, keyboard

- SCAN bar: on the pick page, scan adds the serial to the open request. Success/error **Web Audio beep** (no external file) + on-screen flash.
- Location barcodes `LOC-SITE-BLDG-ROOM-RACK-SHELF-BIN`. Transfer/putaway: scan container serial, then scan location barcode to move. Print location labels from Transfer (seeded bins).
- Duplicate last receipt: copies material/supplier/location/container type; user changes lot/qty/N.
- Requester form is keyboard-first: material typeahead, qty, needed-by, Enter submits (defaults for destination/purpose).

## 6. Inbox

IndexedDB `inbox`: request submitted/issued/ready, material approved/rejected, insufficient stock. Unread badge on nav. `viewInbox` for all authenticated roles.

## 7. Capabilities (closed list additions)

`submitMaterial`, `submitRequest`, `fulfillRequest`, `samplePull`, `viewInbox`.

Default matrix preserves SoD: QA does not receive, issue, or fulfillRequest. New SoD rule: `qaDisposition XOR fulfillRequest`.

Seeded role **requester** (Requester / Lab-Production). Demo user `lab` / `LabUser123!x` (must change password).

## 8. Later (not this version)

Kitting / BOM issue, ASN / CSV inbound, temperature excursion logs.

## 9. Certificates / CoA attachments

Operators (`receive`) and QA (`qaDisposition`) may attach CoA, CofC, SDS, Spec, or Other files (PDF, JPEG, PNG, WebP, GIF; max 10 MB) at goods receipt — lot-level on the receipt batch and optionally per serial — or later from the record / scan page. Files are stored in IndexedDB with the serial or receipt batch; this is **not** a validated document management system. Backup JSON includes base64 attachment bytes. Audit `ATTACHMENT_ADD` records file name and SHA-256, not the blob. Append-only (no delete).

## 10. Material Transfer Form mapping (app v1.4)

The in-app Material Transfer is the electronic equivalent of the site paper MTF (A/B/C), not a clone of any branded PDF. **Section A (Requestor):** material, qty+UOM, to-location (LVM / SVM / QC Testing / Warehouse / Other), classification (GMP and/or High Quality), intended use, needed-by; requestor e-sign → status `Pending Supervisor` (`submitRequest`). Supervisor e-sign (`approveRequest`) → `Approved`, or `Pending QA` when cell bank/quarantined. QA e-sign uses existing `qaDisposition` → `Approved`. FEFO reserve runs only on `Approved`. **Section B (Materials Management):** warehouse pick is allowed only for `Approved` / `Picking` / `Partially Issued` (`fulfillRequest`); MM comments or N/A plus MM e-sign on confirm issue; lot/expiry/source location filled from scanned serials. Quarantine serials may be picked only after QA e-sign on a cell-bank/quarantine transfer. **Section C (Receiver):** qty received + receiver e-sign (`confirmRequestReceipt`) → `Closed`. Audit: `REQUEST_SUPERVISOR_APPROVE`, `REQUEST_QA_APPROVE`. Printed card header is `DOC-WH-INV-001 Material Transfer` + requestId.

