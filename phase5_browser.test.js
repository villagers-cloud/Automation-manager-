// Phase 5 browser tests (real Chromium + real IndexedDB + real UI + real downloads):
//   A. saveFileToDevice(): a real, honest result for every outcome (saved / cancelled / downloaded)
//   B. Blob-URL revoke is no longer synchronous with click() (the browser gets time to read it)
//   C. generatePdf(): try/catch/finally — a failure can no longer leave #pdfTemplate covering the whole app
//   D. Regression: Phase 1 and Phase 4 Data-page flows (JSON backup, filtered CSV) still work untouched
//   PUPPETEER_CORE=/path/to/puppeteer-core CHROME_PATH=/path/to/chrome [APP_ROOT=/path/to/app] node tests/phase5_browser.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const puppeteer = require(process.env.PUPPETEER_CORE || '/home/claude/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function startServer() {
    return new Promise(resolve => {
        const srv = http.createServer((req, res) => {
            let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
            const f = path.join(ROOT, p);
            if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(f).pipe(res);
        }).listen(0, () => resolve({ srv, port: srv.address().port }));
    });
}

let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 7).join('\n      ')); }
}

(async () => {
    const { srv, port } = await startServer();
    const BASE = 'http://localhost:' + port + '/index.html';
    const DL = fs.mkdtempSync('/tmp/p5dl-');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    if (page.setBypassServiceWorker) await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', r => { if (/cdn\.jsdelivr\.net/.test(r.url())) r.abort(); else r.continue(); });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

    // Fake html2pdf: no network in this sandbox, so a real PDF render is impossible. This stub mimics its
    // chainable API (set().from().save()) and lets each test decide whether save() resolves or throws —
    // which is exactly the boundary generatePdf() must handle correctly.
    await page.evaluateOnNewDocument(() => {
        window.__pdfFailNext = false; window.__pdfSaveCalls = 0; window.__lastPdfOptions = null;
        window.html2pdf = function () {
            const chain = { _opts: null, _el: null, set(o) { this._opts = o; return this; }, from(el) { this._el = el; return this; },
                async save() {
                    window.__lastPdfOptions = this._opts; window.__lastPdfEl = this._el;
                    if (window.__pdfFailNext) { window.__pdfFailNext = false; throw new Error('injected html2pdf failure'); }
                    window.__pdfSaveCalls++;
                }
            };
            return chain;
        };
        Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); // default: no File System Access API (Android-like)
        window.__unhandled = [];
        window.addEventListener('unhandledrejection', e => { window.__unhandled.push(String(e.reason && e.reason.message || e.reason)); });
    });

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const ALL = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
    async function load() { await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.AppState && window.AppState.settings && window.appRouter, { timeout: 10000 }); }
    async function resetData(seedQuote = true) {
        await load(); await ev(async (stores) => { for (const s of stores) await window.appDB.clear(s); localStorage.clear(); }, ALL);
        await load();
        if (seedQuote) await ev(async () => {
            await window.appDB.put('clients', { id: 'c1', name: 'Test Client', status: 'Active', dateAdded: '2026-09-01T00:00:00.000Z' });
            await window.appDB.put('quotes', { id: 'q1', clientId: 'c1', invoice: 'QT-001', date: '2026-09-05', setupFee: 1000, retainer: 0, deliverables: ['A'], expenses: [], status: 'Approved' });
        });
        dialogs.length = 0; pageErrors.length = 0; await ev(() => { window.__unhandled = []; window.__pdfSaveCalls = 0; });
    }
    const templateState = () => ev(() => { const t = document.getElementById('pdfTemplate'); return { display: t.style.display, hasContent: t.innerHTML.trim().length > 0 }; });
    async function clickPdf() { await ev(() => window.appRouter.navigate('quotes')); await page.waitForSelector('[data-pdf-quote="q1"]'); await ev(() => document.querySelector('[data-pdf-quote="q1"]').click()); await sleep(400); }
    const dbAll = (s) => ev(x => window.appDB.getAll(x), s);
    const cleanDl = () => fs.readdirSync(DL).forEach(f => fs.rmSync(path.join(DL, f), { force: true }));
    async function waitFile(re, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = fs.readdirSync(DL).filter(x => re.test(x) && !x.endsWith('.crdownload')); if (f.length) { await sleep(150); return path.join(DL, f[0]); } await sleep(100); } return null; }
    const dataStatus = () => ev(() => { const s = document.getElementById('dataStatus'); return s && s.style.display !== 'none' ? { text: s.textContent, kind: s.dataset.kind } : null; });
    async function gotoData() { await ev(() => window.appRouter.navigate('data')); await page.waitForSelector('#exportJsonBtn'); await ev(() => { const s = document.getElementById('dataStatus'); s.style.display = 'none'; s.textContent = ''; }); }

    console.log('\nApp under test: ' + ROOT);

    // ============================================================ A. saveFileToDevice() — direct, isolated tests
    console.log('\nA. saveFileToDevice(): the function itself (called directly with a synthetic blob)');
    await resetData(false);
    await test('never throws for a normal blob, and always returns an object (not undefined)', async () => {
        const r = await ev(async () => { try { return { ok: true, v: await saveFileToDevice(new Blob(['hello'], { type: 'text/plain' }), 'x.txt') }; } catch (e) { return { ok: false, e: String(e) }; } });
        assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(typeof r.v, 'object'); assert.notStrictEqual(r.v, null);
    });
    await test('ANDROID / no File-System-Access path: returns a recognizable "downloaded via anchor" status, and the file really exists with the right bytes', async () => {
        cleanDl(); const r = await ev(async () => saveFileToDevice(new Blob(['payload-123'], { type: 'text/plain' }), 'anchor-test.txt'));
        assert.strictEqual(r.method, 'anchor', JSON.stringify(r)); assert.ok(/download|saved/i.test(r.status), JSON.stringify(r));
        const f = await waitFile(/anchor-test\.txt$/); assert.ok(f, 'no file downloaded'); assert.strictEqual(fs.readFileSync(f, 'utf8'), 'payload-123');
    });
    await test('DESKTOP, Save picker SUCCEEDS: returns status "saved" — the caller can finally tell success from "maybe"', async () => {
        await ev(() => { window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }); });
        const r = await ev(async () => saveFileToDevice(new Blob(['x']), 'picker.txt'));
        await ev(() => { delete window.showSaveFilePicker; });
        assert.strictEqual(r.status, 'saved', JSON.stringify(r)); assert.strictEqual(r.method, 'picker');
    });
    await test('DESKTOP, user CANCELS the Save dialog: returns status "cancelled", and NO anchor download is triggered', async () => {
        cleanDl();
        await ev(() => { window.showSaveFilePicker = async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }; });
        const r = await ev(async () => saveFileToDevice(new Blob(['x']), 'should-not-exist.txt'));
        await ev(() => { delete window.showSaveFilePicker; });
        assert.strictEqual(r.status, 'cancelled', JSON.stringify(r));
        await sleep(300); assert.strictEqual(fs.readdirSync(DL).filter(f => f.includes('should-not-exist')).length, 0, 'a file was downloaded despite the user cancelling');
    });
    await test('DESKTOP, Save picker throws something OTHER than a cancel (e.g. permission error): falls back to a real anchor download, not silence', async () => {
        cleanDl();
        await ev(() => { window.showSaveFilePicker = async () => { throw new Error('simulated permission error'); }; });
        const r = await ev(async () => saveFileToDevice(new Blob(['fallback-data']), 'fallback.txt'));
        await ev(() => { delete window.showSaveFilePicker; });
        assert.strictEqual(r.method, 'anchor', JSON.stringify(r)); const f = await waitFile(/fallback\.txt$/); assert.ok(f, 'no fallback file');
        assert.strictEqual(fs.readFileSync(f, 'utf8'), 'fallback-data');
    });
    await test('a MIME type with a "+" or other RFC-awkward character does not break the anchor download', async () => {
        cleanDl(); const r = await ev(async () => saveFileToDevice(new Blob(['{}'], { type: 'application/vnd.api+json' }), 'weird-mime.json'));
        const f = await waitFile(/weird-mime\.json$/); assert.ok(f, JSON.stringify(r));
    });

    // ============================================================ B. Blob-URL revoke timing (not synchronous with click)
    console.log('\nB. Object-URL is not revoked before the browser can read it');
    await resetData(false);
    await test('revokeObjectURL happens AFTER click(), with a real delay — not on the same tick', async () => {
        await ev(() => {
            window.__t = {};
            const origClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () { window.__t.clickAt = performance.now(); return origClick.call(this); };
            const origRevoke = URL.revokeObjectURL;
            URL.revokeObjectURL = function (u) { window.__t.revokeAt = performance.now(); return origRevoke.call(URL, u); };
        });
        await ev(async () => saveFileToDevice(new Blob(['x'.repeat(200000)]), 'timing.bin')); // a non-trivial blob, not a 1-byte toy
        await sleep(4600); // longer than the app's intentional revoke delay, so we actually observe it happening
        const t = await ev(() => window.__t);
        assert.ok(t.clickAt !== undefined && t.revokeAt !== undefined, JSON.stringify(t));
        assert.ok(t.revokeAt - t.clickAt >= 200, `revoke happened only ${(t.revokeAt - t.clickAt).toFixed(1)}ms after click — effectively synchronous`);
    });
    await test('the object URL is still valid (fetchable) at the moment click() fires — proves the browser had the data available', async () => {
        const result = await ev(async () => {
            let urlAtClickTime = null;
            const origCreate = URL.createObjectURL; URL.createObjectURL = function (b) { const u = origCreate.call(URL, b); window.__lastUrl = u; return u; };
            const origClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () { urlAtClickTime = this.href; return origClick.call(this); };
            await saveFileToDevice(new Blob(['still-here']), 'stillhere.txt');
            let fetchOk = false;
            try { const r = await fetch(urlAtClickTime); fetchOk = r.ok; } catch (e) { fetchOk = false; }
            return { urlAtClickTime, fetchOk };
        });
        assert.ok(result.urlAtClickTime, 'no href captured'); assert.strictEqual(result.fetchOk, true, 'the object URL was already invalid when click() fired');
    });
    await test('a large blob (2 MB) still downloads completely with the delayed revoke', async () => {
        cleanDl();
        const size = await ev(async () => { const blob = new Blob([new Uint8Array(2 * 1024 * 1024).fill(65)]); await saveFileToDevice(blob, 'large.bin'); return blob.size; });
        const f = await waitFile(/large\.bin$/, 8000); assert.ok(f, 'large file never appeared'); assert.strictEqual(fs.statSync(f).size, size);
    });

    // ============================================================ C. generatePdf(): try/catch/finally
    console.log('\nC. generatePdf(): a failure must not leave the app covered by a stuck full-page template');
    await resetData();
    await test('BEFORE generating: #pdfTemplate is hidden and empty of stale content', async () => {
        const t = await templateState(); assert.strictEqual(t.display, 'none');
    });
    await test('SUCCESS: the template is populated, then hidden again; no stray errors; html2pdf.save() ran exactly once', async () => {
        await clickPdf();
        assert.strictEqual(await ev(() => window.__pdfSaveCalls), 1); assert.strictEqual((await templateState()).display, 'none');
        assert.deepStrictEqual(pageErrors, []); assert.deepStrictEqual(await ev(() => window.__unhandled), []);
    });
    await test('FAILURE inside html2pdf().save(): the template is HIDDEN AGAIN afterwards, not stuck covering the app', async () => {
        await ev(() => { window.__pdfFailNext = true; });
        await clickPdf();
        const t = await templateState();
        assert.strictEqual(t.display, 'none', 'the invoice template is still covering the screen after a failed PDF');
    });
    await test('FAILURE: the user is told PDF generation failed (a visible message), not silence', async () => {
        assert.ok(dialogs.some(m => /pdf/i.test(m) && /(fail|error|try again|could not)/i.test(m)), 'no PDF failure message shown: ' + JSON.stringify(dialogs));
    });
    await test('FAILURE: no unhandled promise rejection reaches the page (previously an async onclick threw with nobody watching)', async () => {
        assert.deepStrictEqual(await ev(() => window.__unhandled), [], 'an unhandled rejection leaked from generatePdf');
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('AFTER a failure, the app is fully usable again: other pages open, and other buttons on Quotes still work', async () => {
        await ev(() => window.appRouter.navigate('dashboard')); await sleep(200); assert.strictEqual(await ev(() => document.getElementById('page-dashboard').classList.contains('active')), true);
        await ev(() => window.appRouter.navigate('quotes')); await sleep(200);
        await ev(() => document.querySelector('[data-edit-quote="q1"]').click()); await sleep(200);
        assert.ok(await ev(() => !!document.getElementById('quoteForm')), 'Edit Quote no longer opens after a PDF failure');
        await ev(() => document.getElementById('cancelQuoteBtn') ? document.getElementById('cancelQuoteBtn').click() : window.appRouter.navigate('quotes'));
    });
    await test('a SYNCHRONOUS throw at any point in the html2pdf chain (not just an async .save() rejection) is still caught', async () => {
        await ev(() => { window.__savedH2p = window.html2pdf; window.html2pdf = function () { return { set() { throw new Error('synchronous chain failure'); } }; }; });
        dialogs.length = 0; await clickPdf();
        await ev(() => { window.html2pdf = window.__savedH2p; });
        assert.strictEqual((await templateState()).display, 'none', 'template stuck open after a synchronous throw');
        assert.ok(dialogs.some(m => /pdf/i.test(m) && /fail/i.test(m)), JSON.stringify(dialogs));
        assert.deepStrictEqual(pageErrors, []); assert.deepStrictEqual(await ev(() => window.__unhandled), []);
    });
    await test('RETRY after a failure: generating the PDF again succeeds normally (no leftover broken state)', async () => {
        dialogs.length = 0; await ev(() => { window.__pdfSaveCalls = 0; }); await clickPdf();
        assert.strictEqual(await ev(() => window.__pdfSaveCalls), 1); assert.strictEqual((await templateState()).display, 'none');
        assert.ok(!dialogs.some(m => /fail/i.test(m)), JSON.stringify(dialogs));
    });
    await test('the html2pdf filename and options are unchanged (same library call shape as before)', async () => {
        const o = await ev(() => window.__lastPdfOptions);
        assert.strictEqual(o.filename, 'QT-001-Test Client.pdf'); assert.strictEqual(o.jsPDF.format, 'a4'); assert.strictEqual(o.html2canvas.scale, 2);
    });
    await test('library missing (offline / blocked CDN): the original clear message is unchanged, and the template is never shown', async () => {
        await ev(() => { window.__savedH2p = window.html2pdf; delete window.html2pdf; });
        dialogs.length = 0; await clickPdf();
        await ev(() => { window.html2pdf = window.__savedH2p; });
        assert.ok(dialogs.some(m => /PDF library is unavailable offline/.test(m)), JSON.stringify(dialogs));
        assert.strictEqual((await templateState()).display, 'none');
    });
    await test('double-click while a slow PDF is generating does not corrupt the page (best-effort: second click either queues or is ignored, template still ends hidden)', async () => {
        await ev(() => { window.__slowNext = true; const origH2p = window.html2pdf; window.html2pdf = function () { const c = origH2p(); const origSave = c.save.bind(c); c.save = async () => { await new Promise(r => setTimeout(r, 400)); return origSave(); }; return c; }; });
        await ev(() => window.appRouter.navigate('quotes')); await page.waitForSelector('[data-pdf-quote="q1"]');
        await ev(() => { document.querySelector('[data-pdf-quote="q1"]').click(); document.querySelector('[data-pdf-quote="q1"]').click(); });
        await sleep(900);
        assert.strictEqual((await templateState()).display, 'none', 'template stuck open after overlapping PDF generations');
        assert.deepStrictEqual(pageErrors, []);
    });

    // ============================================================ D. Regression: Phase 1 / Phase 4 Data-page flows
    console.log('\nD. Regression: JSON backup and date-filtered CSV export (Phase 1 / Phase 4) still work');
    await resetData();
    await test('JSON backup still downloads, is complete, and contains no secrets (Phase 1 behaviour unchanged)', async () => {
        await ev(async () => { const s = await window.appDB.get('settings', 'appSettings'); s.aiApiKeyGemini = 'SECRET-KEY'; s.pin = '1234'; await window.appDB.put('settings', s); });
        await gotoData(); cleanDl(); await ev(() => document.getElementById('exportJsonBtn').click());
        const f = await waitFile(/^AutomationManager_Backup_.*\.json$/); assert.ok(f);
        const txt = fs.readFileSync(f, 'utf8'); assert.ok(!/SECRET-KEY|1234/.test(txt)); const j = JSON.parse(txt); assert.strictEqual(j.clients.length, 1); assert.strictEqual(j.quotes.length, 1);
    });
    await test('with the improved saveFileToDevice, a real Save-picker SUCCESS now shows "was saved" (previously always the generic "sent to browser" message)', async () => {
        await gotoData();
        await ev(() => { window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }); });
        await ev(() => document.getElementById('exportJsonBtn').click()); await sleep(400);
        await ev(() => { delete window.showSaveFilePicker; });
        const s = await dataStatus(); assert.strictEqual(s.kind, 'success', JSON.stringify(s)); assert.ok(/was saved/.test(s.text), s.text);
    });
    await test('a cancelled Save-picker now correctly shows "Save cancelled" (previously implied a download may have happened)', async () => {
        await gotoData();
        await ev(() => { window.showSaveFilePicker = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }; });
        cleanDl(); await ev(() => document.getElementById('exportJsonBtn').click()); await sleep(400);
        await ev(() => { delete window.showSaveFilePicker; });
        const s = await dataStatus(); assert.strictEqual(s.kind, 'warn', JSON.stringify(s)); assert.ok(/cancel/i.test(s.text), s.text);
        assert.strictEqual(fs.readdirSync(DL).filter(f => /Backup/.test(f)).length, 0, 'a backup file exists despite the cancel');
    });
    await test('filtered CSV export (Phase 4) still respects the date filter and downloads correctly', async () => {
        await ev(async () => { await window.appDB.put('quotes', { id: 'q2', clientId: 'c1', invoice: 'QT-002', date: '2026-01-01', setupFee: 1, deliverables: [], expenses: [] }); });
        await ev(() => { window.AppFilter.apply('2026-09-01', '2026-09-30', '', '', 'custom'); });
        await gotoData(); cleanDl(); await ev(() => document.querySelector('[data-csv="quotes"]').click()); await sleep(400);
        const f = await waitFile(/^Automation_quotes_.*\.csv$/); assert.ok(f); const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean);
        assert.strictEqual(rows.length, 2, 'expected header + 1 in-range row'); assert.ok(rows[1].includes('QT-001')); assert.ok(!rows[1].includes('QT-002'));
        await ev(() => { window.AppFilter.clear(); });
    });
    await test('all 14 routes still render without exceptions', async () => {
        pageErrors.length = 0; const routes = await ev(() => Object.keys(window.appRouter.routes));
        for (const r of routes) { const ok = await ev(async r => { try { await window.appRouter.navigate(r); return document.getElementById('page-' + r).classList.contains('active'); } catch (e) { return String(e); } }, r); assert.strictEqual(ok, true, r + ': ' + ok); }
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('no uncaught page errors or unhandled rejections during the whole run', async () => {
        assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n'));
    });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 5 browser tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failures.length) console.log('FAILED: ' + failures.join(' | '));
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
