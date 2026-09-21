AUTOMATION MANAGER - Phases 1 to 4 (final versions)

COPY THESE 6 FILES over the same paths in your project (they replace the old ones):
  js/utils/migration.js          (Phase 1)
  js/utils/helpers.js            (Phase 2)
  js/app.js                      (Phase 2)
  js/views/billing.js            (Phase 3)
  js/views/projects.js           (Phase 3)
  js/views/reports_settings.js   (Phase 4 - already contains the Phase 1 changes)

NOTE: js/views/reports_settings.js from Phase 1 is OLD. Use only this one.

tests/ folder (optional, not used by the app):
  tests/test_helpers.js  -> replaces your existing tests/test_helpers.js (recommended: the old one
                            asserted the UTC-date bug and fails in timezones west of UTC)
  the other 8 files are new regression tests; they need Node, and the *browser* ones also need
  puppeteer-core + Chromium. You can skip them.

DO NOT TOUCH: every other file (navigation.js, database.js, sw.js, index.html, manifest.json, css/,
dashboard.js, clients.js, services.js, quotes.js, team_notes.js) is identical to your original ZIP.

AFTER SAVING: hard-reload the app once (or clear site data) - sw.js still caches the old JS until Phase 6.
