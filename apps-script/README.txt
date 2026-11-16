PPA Maintenance Board — Flight Log Google Sheet (billing)

The secretary uses this Sheet to pull CFI post-flight times for billing.
Flight Schedule Pro remains the official hours record. CFI-reported Tach/Hobbs
never change the hours on the board.

The board sends each report to this web app AND keeps a copy in Firestore as a
backup. Existing "Export flight log CSV" still works.

SECURITY NOTE: The web app URL and shared token are stored in the board's
public settings (config/public) so the CFI page can POST a row after submit.
Anyone who can load the board can read them. The token is only light protection
against casual posts. The script still checks the token, validates fields, and
ignores duplicate Report IDs. Do not put any other secrets in this script.

Setup (about 10 minutes), signed in as kylehudson1014@gmail.com:

1. In Google Drive, create a new Google Sheet. Name it "PPA Flight Log".
2. Open the Sheet, then Extensions → Apps Script. Delete the starter code.
3. Paste the contents of apps-script/flight-log.gs into Code.gs. Save.
4. Project Settings (gear) → Script properties → Add script property:
     Property: SHARED_TOKEN
     Value:   a long random phrase only you and the board will know
   Save.
5. Deploy → New deployment → Type: Web app.
     Description: PPA Flight Log
     Execute as: Me (kylehudson1014@gmail.com)
     Who has access: Anyone
   Click Deploy, authorize the Google account if asked, and copy the Web app URL
   (it ends in /exec).
6. On the board: Settings → Flight log Google Sheet. Paste the Web app URL and
   the same SHARED_TOKEN, then Save.
7. Submit a test post-flight report (demo is fine for a dry run; live will write
   a real row). Confirm a "Flight Log" tab appears, and that a snapped meter
   photo (if you used Snap meter) lands in the Drive folder "PPA Flight Log Photos".

If a row doesn't show up, an editor can use Settings → Resend unsent to Sheet.
Duplicates are ignored by Report ID. Meter photos are only on the original POST
(they are not stored in Firestore), so a resend may have blank photo columns.

To rotate the token: change SHARED_TOKEN in Script properties and in Settings
at the same time.
