AUTOMATION MANAGER - complete app with Phase 1-5 repairs applied

This is the WHOLE app (runtime files + tests), ready to be the base of a new repo.
Open index.html through any static web server (GitHub Pages works as is).

Runtime files : index.html, manifest.json, sw.js, css/, js/, assets/
Tests (optional): tests/   (Node; the *browser* tests also need puppeteer-core + Chromium)

CHANGED SINCE THE ORIGINAL ZIP (Phases 1-5):
  js/utils/migration.js          Phase 1 - safe, idempotent localStorage -> IndexedDB migration
  js/views/reports_settings.js   Phase 1 + Phase 4 - safe JSON backup/restore, real CSV, Settings/PIN
                                  fixes, Reports empty/error states, CSV honours the date filter
  js/utils/helpers.js            Phase 2 + Phase 5 - local-timezone dates, complete settings defaults,
                                  saveFileToDevice() now returns an honest result and delays the Blob-URL revoke
  js/app.js                      Phase 2 - local-timezone date-filter presets
  js/views/billing.js            Phase 3 - lookup lists (invoices/projects) no longer wrongly date-filtered,
                                  deleting keeps the active filter, local-timezone due date
  js/views/projects.js           Phase 3 - same lookup-list fix for the Tasks page (was silently
                                  unlinking a task's project/client when edited under a filter)
  js/views/quotes.js             Phase 5 - generatePdf() try/catch/finally: a failure can no longer
                                  leave the invoice template covering the whole app
  tests/test_helpers.js          updated (its old getTodayDate tests asserted the UTC-date bug)

NOT changed - identical to your original ZIP:
  index.html, manifest.json, sw.js, css/style.css, assets/icon-192.png, assets/icon-512.png,
  js/ui/navigation.js, js/db/database.js, js/views/dashboard.js, js/views/clients.js,
  js/views/services.js, js/views/team_notes.js

Left out on purpose (development leftovers, not used by the app - still in your ORIGINAL repo):
  screenshots (*.png in the root), benchmark.py, benchmark_optimized.py, test_ui.py, .jules/

NOT done yet:
  Phase 6 - sw.js still uses cache name automation-manager-v2; bump it before updating an
            already-installed copy of the app, or users may keep seeing the old JS.
  Phase 7 - optional polish (quotes.js N+1 lookup, icons, colour palette, extending the date
            filter to the Quotes/Projects lists, CSV formula-injection guarding, HTML escaping
            of a few untrusted fields).
