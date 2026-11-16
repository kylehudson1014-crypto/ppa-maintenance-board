# PPA Maintenance Board

Standalone maintenance status board for Patriot Pilot Academy: AV1ATED status, location, squawks, hours to the next 100-hour, and status notes for 10–25 aircraft.

**Tracking aid only. The aircraft maintenance logbooks are the legal record.**

| Screen | Link | Who |
|---|---|---|
| TV display | `#tv` (one base only: `#tv?loc=KECP`) | Lobby / dispatch TV |
| Fleet status | `#board` | Customers, renters, CFIs (read-only) |
| Report a squawk | `#squawk` | Any CFI |
| Edit fleet | `#edit` | Owner + mechanic |
| Settings | `#settings` | Owner + mechanic |

* **Demo mode** (default, `js/config.js` → `firebaseConfig: null`): SAMPLE aircraft, data saved on that device only.
* **Live mode**: paste a free Firebase (Spark) project config into `js/config.js`. Rules: `firebase/firestore.rules` (tested: `test/rules.test.mjs`, 33 checks).
* **Email alerts**: free Google Apps Script in `alerts/` (Code.gs + js/status.js). OFF until switched on in Settings.
* **CSV**: `template.csv`; import matches by tail number or FSP aircraft ID; blank cells never erase.
* **FSP refresh**: Settings → Import FSP Maintenance Status Report. Upload the PDF from Flight Schedule Pro’s Maintenance Status Report; preview new/changed/unchanged aircraft and open squawks, then confirm. Existing planes are never deleted.

Status logic lives in `js/status.js` (shared by the web app and the alert sender).
