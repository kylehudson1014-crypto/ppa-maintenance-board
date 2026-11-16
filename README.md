# PPA Maintenance Board

Standalone maintenance status board for Patriot Pilot Academy: AV1ATED status, location, squawks, hours to the next 100-hour, and status notes for 10–25 aircraft.

**Tracking aid only. The aircraft maintenance logbooks are the legal record.**

| Screen | Link | Who |
|---|---|---|
| TV display | `#tv` (one base only: `#tv?loc=KECP`) | Lobby / dispatch TV |
| Fleet status | `#board` | Customers, renters, CFIs (read-only) |
| Post-flight report | `#squawk` | Any CFI (oil, Tach/Hobbs, optional squawk) |
| Edit fleet | `#edit` | Owner + mechanic |
| Settings | `#settings` | Owner + mechanic |

* **Demo mode** (default, `js/config.js` → `firebaseConfig: null`): SAMPLE aircraft, data saved on that device only.
* **Live mode**: paste a free Firebase (Spark) project config into `js/config.js`. Rules: `firebase/firestore.rules` (tested: `test/rules.test.mjs`, 54 checks).
* **Email alerts**: free Google Apps Script in `alerts/` (Code.gs + js/status.js). OFF until switched on in Settings.
* **CSV**: `template.csv`; import matches by tail number or FSP aircraft ID; blank cells never erase.
* **FSP refresh**: Settings → Import FSP Maintenance Status Report. Upload the PDF from Flight Schedule Pro’s Maintenance Status Report; preview new/changed/unchanged aircraft and open squawks, then confirm. Existing planes are never deleted.

* **Post-flight reports:** CFIs submit a paper-log replacement on `#squawk` (instructor, optional student, oil, start/end Tach and Hobbs, optional squawk, optional Snap meter photo). Times are a flight log for billing only — Flight Schedule Pro stays the official hours record, and CFI times never change Tach or Hobbs on the board. Start times still prefill from the current board meters (FSP import or editor entry). Editors can export a flight-log CSV from Settings / Edit, and can connect a Google Sheet (see `apps-script/`) so each report is also appended for the secretary. Meter photos, if snapped, go to a Drive folder via that Sheet script and are not stored in Firestore. Reports are stored in `flightReports`.
* **Oil tracking:** The editor fleet list and aircraft page show quarts added in the last 30 days, since the last FSP import (or all time), and a qt-per-10-hours rate from CFI reports when there is enough data.

Status logic lives in `js/status.js` (shared by the web app and the alert sender).
