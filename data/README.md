# Colony Snapshot Data

Per-month snapshots of active colonies and owner / referral-code mining activity.

- Files are named `colony-monthly-YYYY-MM.json`.
- Written daily at ~00:30 UTC by `.github/workflows/colony-snapshot.yml`
  (script: `scripts/colony-snapshot.js`).
- Consumed by `assets/js/colony-monthly.js` on the ANTS Program page.
- One file per UTC month; new month → new file (the previous month's file
  becomes the "archive" automatically).

This is a presentation-layer snapshot derived from the public stats endpoint
`https://explorer.a-network.net/stats/investor`. The canonical source of
truth remains the chain itself.
