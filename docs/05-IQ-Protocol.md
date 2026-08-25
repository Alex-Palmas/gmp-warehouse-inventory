# Installation Qualification Protocol — Warehouse Inventory System

| Field | Value |
|-------|-------|
| Document | IQ-WH-INV-001 |
| Version | 1.0 (draft template) |
| Site | [SITE] |
| Owner | [OWNER] |
| Date | [DATE] |
| Status | **Not approved / not executed** |
| Software | DOC-WH-INV-001 v1.0 |

## 1. Objective

Verify that the application is installed on the target workstation/environment as specified, with the correct version, dependencies, and configuration, **before** operational testing.

## 2. Responsibilities

- Executor: [OWNER] / CSV
- Reviewer: QA [SITE]
- IT (workstation): [SITE]

## 3. Prerequisites

- Approved URS, FS, RA (or documented concurrent review)
- Node.js 18+ available if building from source, **or** a site-controlled static `dist/` deploy
- Identified workstation ID: _______________
- Browser (name/version): _______________

## 4. Tests

### IQ-01 Source / build identity
- Record git/commit or zip hash of release: _______________
- Record app version from README / footer: expected `1.0.0`
- Pass / Fail / NA: ___  Actual: _______________  Initials/date: ___

### IQ-02 Dependencies
- From project root, install packages using the Node package manager (`package-lock` present).
- Confirm `package-lock.json` is the site-controlled file.
- Pass / Fail: ___  Notes: _______________

### IQ-03 Build
- Run production build script. Expect success, `dist/` produced.
- Pass / Fail: ___  Log attached: Y/N

### IQ-04 Launch
- Start preview or serve `dist/` from a controlled path.
- Record URL: _______________
- Banner visible: "Not validated — do not use for GMP decisions until IQ/OQ/PQ approved."
- Pass / Fail: ___

### IQ-05 Browser IndexedDB
- Confirm origin (scheme/host/port) recorded: _______________
- Confirm database name `gmp-wh-inv` (DevTools → Application) after first login.
- Pass / Fail: ___

### IQ-06 Printer (labels)
- Identify label printer: _______________
- Print a blank/test page from the OS. Attach.
- Pass / Fail / NA: ___

### IQ-07 Scanner
- Identify HID scanner model: _______________
- Scanner types characters into Notepad + Enter. Pass / Fail / NA: ___

### IQ-08 Time zone display
- Workstation TZ: _______________ (app displays America/Los_Angeles; store UTC)
- If site requires a different display TZ, raise change control.
- Pass / Fail: ___

### IQ-09 Demo accounts
- Confirm procedure to change/deactivate demo passwords before GMP use is listed in SOP.
- Pass / Fail: ___

### IQ-10 Documentation pack present
- Confirm docs 01–10 and companion xlsx on the controlled share.
- Pass / Fail: ___

## 5. Deviations

| # | Description | Disposition |
|---|-------------|-------------|
| | | |

## 6. Conclusion

IQ is [ ] Passed  [ ] Passed with deviations  [ ] Failed

## 7. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Executor | | | |
| Reviewer QA | | | |
| System owner | | | |
