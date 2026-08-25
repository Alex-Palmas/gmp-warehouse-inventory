# Operational Qualification Protocol — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | OQ-WH-INV-001 |
| Version | 1.3 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved / not executed** |
| Software | DOC-WH-INV-001 v1.3 |

Automated unit tests (`vitest`) cover serial format, workflow permissions, audit API immutability, and FEFO logic. They **do not** replace this OQ. Record unit-test log attachment: _______________

For each test: Expected vs Actual, Pass/Fail, Initials, Date. Use a dedicated OQ environment (copy of build). Do not use production lots.

Pre-req: IQ passed. Seeded demo users may be used **only** in OQ; change passwords at start or document as test accounts.

---

### OQ-01 Serial uniqueness and format (URS-01)

**Steps**
1. Log in as warehouse operator.
2. Goods Receipt for material RM-001, qty 1 kg, complete required fields, submit.
3. Record serial S1 = _______________  (expect `WH-` + 4-digit year + `-` + 6 digits).
4. Repeat receipt. Record S2 = _______________
5. Confirm S2 != S1 and sequence incremented.
6. Confirm cancelled draft (navigate away mid-form without submit) does **not** consume a serial (next successful submit is S2+1 only after two successes).

**Expected:** Unique WH-YYYY-NNNNNN; no reuse. **Pass/Fail:** ___

---

### OQ-02 Barcode print / scan round-trip (URS-14)

**Steps**
1. On S1, Labels → 4x2 in → Print (or PDF). Confirm Code 128 human-readable serial matches S1. Confirm QR present.
2. Print 2x1 in. Confirm pagination (one label per page).
3. Using HID scanner, focus SCAN box, scan Code 128. Expect navigation to scan lookup for S1.
4. Audit contains PRINT_LABEL for S1.

**Expected:** Scan returns the same serial; audit row exists. **Pass/Fail:** ___  Scanner ID: _______________

---

### OQ-03 Quarantine default on receipt (URS-02)

**Steps:** After OQ-01, open Register. S1 and S2 status = Quarantine. Operator cannot see a control on receipt that sets Released.

**Expected:** Default Quarantine only. **Pass/Fail:** ___

---

### OQ-04 QA-only release (URS-02, 16)

**Steps**
1. As operator, open QA Disp. Expect denial message.
2. As Read-Only, confirm no mutate forms succeed.
3. As `qa`, disposition S1 = Release with e-sign. Status becomes Released. Audit QA_DISPOSITION with meaningOfSignature and reason.
4. Attempt issue of still-quarantine S2: blocked.

**Expected:** Only QA releases; operator cannot. **Pass/Fail:** ___

---

### OQ-05 Audit trail immutability (URS-06)

**Steps**
1. Open Audit page. Confirm no edit/delete buttons.
2. (CSV/IT) Confirm `src/lib/audit.ts` exports append/list only (or re-run vitest audit test).
3. Perform a cycle count with reason. Confirm old/new qty on new row. Previous rows unchanged.

**Expected:** Append-only. **Pass/Fail:** ___

---

### OQ-06 FEFO warning (URS-05)

**Preconditions:** Two Released lots of same material with different expiry (seed API-001: WH-2026-000001 exp 2028-06-30 and WH-2026-000002 exp 2027-03-15).

**Steps**
1. Issue from the **later** expiry Released lot (000001) qty 1.
2. Expect warning listing earlier serial 000002. Submit without override reason → blocked.
3. Provide override reason → issue succeeds; audit reason includes FEFO override.

**Expected:** Warn + require reason; do not silently skip. **Pass/Fail:** ___

---

### OQ-07 Expiry block (URS-05)

**Steps:** Attempt issue of seed expired lot WH-2026-000007 (Acetaminophen, expiry 2025-12-31, Released). Expect block, no qty change.

**Expected:** Cannot issue expired. **Pass/Fail:** ___

---

### OQ-08 Destruction e-sign (URS-03, 09)

**Steps**
1. As operator, Destruction page denied.
2. As QA, destroy a quarantine test serial with e-sign and reason. Status Destroyed; record still in Register. Cannot transfer/issue.

**Expected:** Logical destroy, QA only, record retained. **Pass/Fail:** ___

---

### OQ-09 Electronic signature (URS-08, 09)

**Steps:** On QA Release, enter wrong password → fail. Correct password → capture printed name, user ID, datetime, meaning. Wrong user cannot sign as another ID.

**Expected:** Re-challenge; attributable. **Pass/Fail:** ___

---

### OQ-10 Roles (URS-16)

Matrix (Y = allowed):

| Action | Operator | Supervisor | QA | QC | Read-Only | SysAdmin |
|--------|----------|------------|----|----|-----------|----------|
| Receive | Y | Y | N | N | N | N |
| Issue Released | Y | Y | N | N | N | N |
| Hold | N | Y | Y | N | N | N |
| QA disposition | N | N | Y | N | N | N |
| Destroy | N | N | Y | N | N | N |
| User admin | N | Y | N | N | N | Y |
| Edit matrix | N | N | N | N | N | Y |
| Material master | N | Y | Y | N | N | N |

QA receive is N under SoD (qaDisposition XOR receive). Intended path: receive as `wh`, release as `qa`.

Execute each cell or justify sampling. **Pass/Fail:** ___

---

### OQ-11 Controlled vocabularies (URS-04, 12)

Receipt item type / UOM / storage are dropdowns. Cannot type arbitrary status into register table (no such editor). **Pass/Fail:** ___

---

### OQ-12 Location transfer (URS-11)

Transfer S1 to a new bin with reason. Movement log + audit location old/new. **Pass/Fail:** ___

---

### OQ-13 Backup / restore (URS-15)

1. Supervisor: Backup JSON. Open file; confirm keys users, materials, inventory, movements, audit, accessLog, serialCounter.
2. Note a serial count N.
3. Receive one more item (N+1). Restore the backup. Confirm extra serial gone and prior data restored. Audit contains RESTORE.
4. Excel export opens; freeze header; footer contains DOC-WH-INV-001 and "not the system of record".

**Pass/Fail:** ___

---

### OQ-14 Dashboard (URS-17, URS-27)

Confirm quarantine count includes S2; expired list includes 000007; 30/90 day lists populated vs current date. KPI tiles are clickable and filter the register / request queue (URS-27). **Pass/Fail:** ___

---

### OQ-15 Document control banner (URS-18)

Every page shows validation banner and footer DOC-WH-INV-001 v1.3. **Pass/Fail:** ___

---

### OQ-16 Material master (URS-19)

As operator, cannot create material (or page does not allow save). As QA or Supervisor, create TEST-MAT, reason if update. Audit MATERIAL_CREATE. **Pass/Fail:** ___

---

## Deviations / Conclusion / Approval

| # | Description | Disposition |
|---|-------------|-------------|
| | | |

OQ is [ ] Passed  [ ] Passed with deviations  [ ] Failed

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Executor | | | |
| Reviewer QA | | | |

---

### OQ-17 Account lockout (URS-07, 11.10(d))

**Steps**
1. As an unknown user, attempt login. Record message M1 = _______________
2. As `wh` with a wrong password, attempt login five times. Record message each time. After 5th failure, access log contains LOGIN_FAIL and LOCKOUT.
3. Immediate 6th attempt (correct or incorrect) still fails with the **same** generic message as M1.
4. Wait 15 minutes **or** log in as `admin` / `sysadmin` → Access → Unlock `wh` with reason. Audit USER_UNLOCK.
5. `wh` logs in with the demo/temp password (then must change password).

**Expected:** 5 failures lock 15 min; generic error; unlock audited. **Pass/Fail:** ___

---

### OQ-18 Permission matrix save (URS-16, 11.10(g))

**Steps**
1. As `admin` (Supervisor), Access → Permission matrix is **read-only** (no save, or save denied).
2. As `sysadmin`, toggle one cell (e.g. QC reprintLabel off). Attempt save without e-sign / reason → blocked.
3. E-sign with meaning “I authorize this access control configuration” and reason. Matrix version increments. Audit MATRIX_SAVE per changed cell (old/new true/false). History tab shows the version.
4. Attempt a save that unchecks `editPermissionMatrix` on **all** roles → blocked (lockout prevention). Restore the test cell.

**Expected:** E-sign required; lockout prevention; append-only history. **Pass/Fail:** ___

---

### OQ-19 SoD receive vs QA disposition (URS-02, 16)

**Steps**
1. As `qa`, Receipt nav is hidden / route denied. Attempting receive API/form fails.
2. As `wh`, receive a new serial Sx into Quarantine.
3. As `qa`, disposition Sx = Release with e-sign succeeds.
4. As `sysadmin`, try to enable **receive** on the QA role with SoD ON and **no** waiver → save blocked.
5. Optional: record a documented SoD waiver, save, then revert.

**Expected:** Default matrix QA cannot receive; SoD blocks combining receive + qaDisposition. **Pass/Fail:** ___

---

### OQ-20 Cannot e-sign own receipt (SoD)

**Steps**
1. Create a test user with a custom role that has **both** receive and qaDisposition **only if** a documented waiver was applied in OQ-19; **otherwise** skip to the unit-test attachment (`assertNotOwnReceipt`).
2. Preferred path when waiver is **not** used: unit test `src/tests/access.test.ts` “user cannot e-sign disposition on record they received” attached as evidence.
3. If a waived dual-capability role is available: that user receives Sy, then attempts QA Release on Sy → blocked with SoD message. A **different** QA user can release Sy.

**Expected:** createdBy === signer is rejected. **Pass/Fail:** ___


---

### OQ-21 Per-container serialization (URS-21)

**Steps**
1. As `wh`, Goods Receipt: material with sampling not required, N containers = 5, container type Vial, qty per container = 1 (e.g. 5 × 1 vial). Submit.
2. Confirm 5 unique serials `WH-YYYY-NNNNNN` and one shared `receiptBatchId` `RCV-YYYY-NNNNNN`. Register groups them (expandable).
3. Print all 5 labels (page-break). Scan one Code 128 → lookup of that serial only.
4. As `qa`, Release with scope = entire receipt batch, one e-sign. All 5 siblings become Released. Audit has a QA_DISPOSITION row per serial.
5. Repeat a receipt of 3 drums × 25 kg. Confirm 3 serials, not one serial covering 3 drums.

**Expected:** One serial per physical unit; batch grouping retained. **Pass/Fail:** ___

---

### OQ-22 Material request → pick → issue (URS-22)

**Steps**
1. As `lab` (change temp password `LabUser123!x`). Request material: typeahead a Released material, qty, needed-by, Enter. Note request id MR-… and any FEFO reserve.
2. As a second requester session (or second request), confirm the same reserved serial cannot be picked for the other request.
3. As `wh`, Requests → warehouse queue. Confirm suggested containers are sorted by location. Print pick ticket. Scan a **quarantine** serial → blocked, error beep, not added. Scan a correct Released serial → success beep, added.
4. Confirm issue. Movement log and audit include requestId. `lab` inbox shows ready. Confirm received → Closed.
5. Cancel a Submitted request: reservation released (Reserved badge gone).

**Expected:** Authorized requisition; FEFO reserve; scan cross-check; chain of custody. **Pass/Fail:** ___

---

### OQ-23 Sample pull

**Steps:** As `qa` or `qc`, Samples: pull qty from a parent drum. Child serial recordKind=sample, parentSerial set, parent currentQty decremented, own barcode. **Pass/Fail:** ___

---

### OQ-24 Location barcode putaway

**Steps:** Transfer → print a location label. Scan a container serial, then scan `LOC-…` barcode. Container location updates; movement TRANSFER. **Pass/Fail:** ___

---

### OQ-25 Submit material

**Steps:** As `lab`, submit a new material. As `qa`, approve with a code. Material appears on Material Master and in Receive dropdown. Inbox notified. **Pass/Fail:** ___

---

### OQ-26 Matrix deny of a split capability (11.10(g))

**Steps**
1. As `wh` (operator), open Submit material. Confirm **Approve** is hidden (no `approveMaterial`). Attempting `approveMaterialSubmission` is denied.
2. As `qa`, Approve is visible and succeeds (writes Material Master). Audit MATERIAL_APPROVE.
3. As `sysadmin`, Access → matrix: operator `qaDisposition` is unchecked. Checking `qaDisposition` **and** `fulfillRequest` on QA (or operator) with SoD ON and no waiver → save blocked.
4. Uncheck `editPermissionMatrix` on all roles → save blocked (lockout prevention).

**Expected:** Per-action caps enforced; SoD fulfillRequest XOR qaDisposition; lockout prevention. **Pass/Fail:** ___

---

### OQ-27 Audit trail on goods receipt (11.10(e))

**Steps**
1. As `wh`, receive 2 containers. Note serials S1, S2.
2. Open Audit (`#/audit`). Newest first. Filter record = S1 (query param `record=`). Confirm RECEIVE row: UTC + local, userId=`wh`, role=operator (or `wh`'s role), old blank, new Quarantine, reason includes receipt batch.
3. Confirm no edit/delete controls. Export CSV (if `exportAudit` / `exportReports`). Open record detail for S1 — same audit rows via `listAuditForRecord`.

**Expected:** Contemporaneous append-only row per serial; RECEIVE includes role=operator (or `wh`'s role). **Pass/Fail:** ___

---

### OQ-28 Audit trail on material request (11.10(e))

**Steps**
1. As `lab`, submit a request. Note MR- id. Audit contains REQUEST_SUBMIT.
2. As `wh`, pick and confirm issue. Audit contains REQUEST_PICK and REQUEST_ISSUE (request id and/or serial).
3. As `lab`, confirm received. Audit REQUEST_CLOSE. Cancel a different Submitted request with reason — REQUEST_CANCEL with reason required.
4. Filter Audit action=`REQUEST_SUBMIT` and date from/to. Deep-link URL retains filters.

**Expected:** Request lifecycle fully trailed; reason on cancel/reject. **Pass/Fail:** ___

---

### OQ-29 Session idle timeout writes SESSION_TIMEOUT (11.10(d)(e))

**Steps**
1. Log in as `wh`. Idle 15 min (or simulate by setting `lastActivityUtc` in sessionStorage to 16 min ago) then wait for the 15s poll.
2. Expect audit SESSION_TIMEOUT with userId and role, then the login screen.
3. Log in again. Confirm a manual **Log out** still writes LOGOUT not SESSION_TIMEOUT.
4. Open Audit. Role column is visible after User. Export CSV and Excel — both include Role. Old rows without role show blank.

**Expected:** Idle timeout writes SESSION_TIMEOUT (not LOGOUT); manual logout writes LOGOUT; Role column/CSV/Excel present; missing role serializes blank. **Pass/Fail:** ___


