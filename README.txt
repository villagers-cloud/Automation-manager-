AUTOMATION MANAGER - complete app with Phase 1-4 repairs applied

This is the WHOLE app (runtime files + tests), ready to be the base of a new repo.
Open index.html through any static web server (GitHub Pages works as is).

Runtime files : index.html, manifest.json, sw.js, css/, js/, assets/
Tests (optional): tests/   (Node; the *browser* tests also need puppeteer-core + Chromium)

Left out on purpose (development leftovers, not used by the app):
  screenshots (*.png in the root), benchmark.py, benchmark_optimized.py, test_ui.py, .jules/
They still exist in your ORIGINAL repo, nothing was deleted there.

Not done yet (later phases): Phase 5 download reliability + PDF error handling (helpers.js, quotes.js),
Phase 6 service worker (sw.js still uses cache name automation-manager-v2 and needs a version bump
before you update an already-installed copy), Phase 7 optional polish.
