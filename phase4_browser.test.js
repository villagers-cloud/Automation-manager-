// Phase 4 browser tests (real Chromium + real IndexedDB + real UI + real downloads):
//   A. Settings theme control      B. PIN preference rules + lock screen      C. Reports empty / error states
//   D. CSV export with the date filter (JSON backup stays complete)      E. regression
//   PUPPETEER_CORE=/path/to/puppeteer-core CHROME_PATH=/path/to/chrome [APP_ROOT=/path/to/app] node tests/phase4_browser.test.js
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
function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
        else if (ch === '"') inQ = true; else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 7).join('\n      ')); }
}

const DATA = () => ({
    clients: [
        { id: 'cIn', name: 'Client In', status: 'Active', dateAdded: '2026-09-10T05:00:00.000Z' },
        { id: 'cOut', name: 'Client Out', status: 'Active', dateAdded: '2026-08-01T05:00:00.000Z' },
        { id: 'cNoDate', name: 'Client No Date', status: 'Active' }                       // no date at all: the filter keeps such records
    ],
    quotes: [{ id: 'qIn', clientId: 'cIn', invoice: 'QT-IN', date: '2026-09-05', setupFee: 10, status: 'Approved' }, { id: 'qOut', clientId: 'cOut', invoice: 'QT-OUT', date: '2026-08-20', setupFee: 20, status: 'Pending' }],
    invoices: [{ id: 'iIn', number: 'INV-IN', date: '2026-09-05', clientId: 'cIn', amount: 500 }, { id: 'iOut', number: 'INV-OUT', date: '2026-08-10', clientId: 'cOut', amount: 900 }],
    expenses: [{ id: 'eIn', name: 'Exp In', amount: 70, date: '2026-09-07', category: 'Office' }, { id: 'eOut', name: 'Exp Out', amount: 50, date: '2026-08-05', category: 'Office' }],
    projects: [{ id: 'prIn', name: 'Proj In', clientId: 'cIn', status: 'In Progress', startDate: '2026-09-01', deadline: '2026-10-01' }, { id: 'prOut', name: 'Proj Out', clientId: 'cOut', status: 'Planning', startDate: '2026-08-01', deadline: '2026-10-01' }],
    payments: [{ id: 'pIn', invoiceId: 'iIn', amount: 300, date: '2026-09-06', method: 'UPI' }, { id: 'pOut', invoiceId: 'iOut', amount: 100, date: '2026-08-15', method: 'UPI' }]
});
const IDS = { clients: ['cIn', 'cOut', 'cNoDate'], quotes: ['qIn', 'qOut'], invoices: ['iIn', 'iOut'], expenses: ['eIn', 'eOut'], projects: ['prIn', 'prOut'], payments: ['pIn', 'pOut'] };
const IN_RANGE = { clients: ['cIn', 'cNoDate'], quotes: ['qIn'], invoices: ['iIn'], expenses: ['eIn'], projects: ['prIn'], payments: ['pIn'] };

(async () => {
    const { srv, port } = await startServer();
    const BASE = 'http://localhost:' + port + '/index.html';
    const DL = fs.mkdtempSync('/tmp/p4dl-');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    if (page.setBypassServiceWorker) await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', r => { if (/cdn\.jsdelivr\.net/.test(r.url())) r.abort(); else r.continue(); });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const wait = (sel) => page.waitForSelector(sel, { timeout: 4000 });
    const ALL = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
    async function load() { await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.AppState && window.AppState.settings && window.appRouter, { timeout: 10000 }); }
    async function resetData(seed = true) {
        await load(); await ev(async (stores) => { for (const s of stores) await window.appDB.clear(s); localStorage.clear(); }, ALL);
        await load();                                       // first run: default settings are created
        if (seed) await ev(async (d) => { for (const [store, rows] of Object.entries(d)) for (const r of rows) await window.appDB.put(store, r); }, DATA());
    }
    const snapshot = () => ev(() => initDB().then(db => new Promise(res => {
        const names = [...db.objectStoreNames].sort(); const tx = db.transaction(names, 'readonly'); const o = {};
        names.forEach(n => { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { o[n] = r.result; }; }); tx.oncomplete = () => res(JSON.stringify(o));
    })));
    const dbSettings = () => ev(() => window.appDB.get('settings', 'appSettings'));
    const dbAll = (s) => ev(x => window.appDB.getAll(x), s);
    const putSettings = (patch) => ev(async (p) => { const s = await window.appDB.get('settings', 'appSettings'); Object.assign(s, p); await window.appDB.put('settings', s); }, patch);
    const go = (r) => ev(x => window.appRouter.navigate(x), r);
    const theme = () => ev(() => document.documentElement.dataset.theme);
    const lockShown = () => ev(() => getComputedStyle(document.getElementById('lockScreen')).display === 'grid');
    const typePin = async (pin) => { for (const k of pin) await ev(x => document.querySelector('[data-pin="' + x + '"]').click(), k); await sleep(450); };
    async function openSettings() { await go('settings'); await wait('#savePrefsBtn'); }
    async function savePrefs({ theme: t, enable, pin }) {
        await ev(({ t, enable, pin }) => {
            if (t !== undefined) document.getElementById('set-themeMode').value = t;
            if (enable !== undefined) document.getElementById('set-pinEnabled').checked = enable;
            if (pin !== undefined) document.getElementById('set-appPin').value = pin;
            document.getElementById('savePrefsBtn').click();
        }, { t, enable, pin }); await sleep(350);
    }
    async function applyFilter(from, to) {
        await ev(() => document.querySelector('.global-filter-btn').click());
        await ev((f, t) => { document.getElementById('filterFromDate').value = f; document.getElementById('filterToDate').value = t; document.getElementById('filterPreset').value = 'custom'; }, from, to);
        await ev(() => document.getElementById('applyFilterBtn').click()); await sleep(300);
    }
    async function clearFilter() { await ev(() => document.querySelector('.global-filter-btn').click()); await ev(() => document.getElementById('clearFilterBtn').click()); await sleep(300); }
    const SEP = ['2026-09-01', '2026-09-30'];
    const cleanDl = () => fs.readdirSync(DL).forEach(f => fs.rmSync(path.join(DL, f), { force: true }));
    async function waitFile(re, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = fs.readdirSync(DL).filter(x => re.test(x) && !x.endsWith('.crdownload')); if (f.length) { await sleep(150); return path.join(DL, f[0]); } await sleep(100); } return null; }
    const dataStatus = () => ev(() => { const s = document.getElementById('dataStatus'); return s && s.style.display !== 'none' ? { text: s.textContent, kind: s.dataset.kind } : null; });
    async function csv(store) {
        cleanDl(); await ev(() => { const s = document.getElementById('dataStatus'); s.style.display = 'none'; s.textContent = ''; });
        await ev(x => document.querySelector('[data-csv="' + x + '"]').click(), store); await sleep(500);
        const f = fs.readdirSync(DL).find(x => /\.csv$/.test(x)); const rows = f ? parseCsv(fs.readFileSync(path.join(DL, f), 'utf8')) : null;
        return { file: f || null, rows, ids: rows ? rows.slice(1).map(r => r[rows[0].indexOf('id')]) : null, status: await dataStatus() };
    }
    const money = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
    const repVals = () => ev(() => ({ rev: repRev.textContent, exp: repExp.textContent, net: repNet.textContent, clients: repClients.textContent, projects: repProjects.textContent, quotes: repQuotes.textContent }));
    const repNotice = () => ev(() => { const n = document.getElementById('repNotice'); return n && n.style.display !== 'none' && n.textContent.trim() ? { text: n.textContent.trim(), kind: n.dataset.kind, role: n.getAttribute('role') } : null; });
    async function openReports() { await go('reports'); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent), { timeout: 4000 }); }

    console.log('\nApp under test: ' + ROOT);

    // ============================================================ A. Settings — theme control
    console.log('\nA. Settings: theme control (the old "Dark Mode" checkbox did nothing)');
    await resetData();
    await test('Settings has a Theme selector (System / Light / Dark) and NO dead Dark Mode checkbox', async () => {
        await openSettings(); await wait('#set-themeMode');
        const st = await ev(() => ({ opts: [...document.querySelectorAll('#set-themeMode option')].map(o => o.value), dead: !!document.getElementById('set-darkMode') }));
        assert.deepStrictEqual(st.opts, ['system', 'light', 'dark']); assert.strictEqual(st.dead, false);
    });
    await test('the selector shows the STORED themeMode', async () => {
        await putSettings({ themeMode: 'dark' }); await load(); await openSettings(); await wait('#set-themeMode'); assert.strictEqual(await ev(() => document.getElementById('set-themeMode').value), 'dark');
    });
    await test('an unknown stored themeMode shows as System and does not break the page', async () => {
        await putSettings({ themeMode: 'blue' }); await load(); await openSettings(); await wait('#set-themeMode'); assert.strictEqual(await ev(() => document.getElementById('set-themeMode').value), 'system');
    });
    await test('choosing Dark + Save applies IMMEDIATELY, is stored as themeMode, and survives a reload', async () => {
        await putSettings({ themeMode: 'light' }); await load(); await openSettings(); await wait('#set-themeMode'); assert.strictEqual(await theme(), 'light');
        await savePrefs({ theme: 'dark' }); assert.strictEqual(await theme(), 'dark'); assert.strictEqual((await dbSettings()).themeMode, 'dark');
        await load(); assert.strictEqual(await theme(), 'dark');
    });
    await test('the new control never writes the legacy "darkMode" field', async () => {
        const before = (await dbSettings()).darkMode; await openSettings(); await wait('#set-themeMode'); await savePrefs({ theme: 'light' }); assert.strictEqual((await dbSettings()).darkMode, before);
    });
    await test('Light works and persists', async () => {
        await openSettings(); await wait('#set-themeMode'); await savePrefs({ theme: 'light' }); assert.strictEqual(await theme(), 'light'); await load(); assert.strictEqual(await theme(), 'light');
    });
    await test('System follows the device: dark OS → dark app, light OS → light app', async () => {
        await openSettings(); await wait('#set-themeMode'); await savePrefs({ theme: 'system' }); assert.strictEqual((await dbSettings()).themeMode, 'system');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await load(); assert.strictEqual(await theme(), 'dark');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await load(); assert.strictEqual(await theme(), 'light');
    });
    await test('top-bar ☾/☀ toggle and Settings stay in sync; Settings can go back to System afterwards', async () => {
        await load(); await ev(() => document.getElementById('themeBtn').click()); await sleep(300); assert.strictEqual(await theme(), 'dark');
        await openSettings(); await wait('#set-themeMode'); assert.strictEqual(await ev(() => document.getElementById('set-themeMode').value), 'dark');
        await savePrefs({ theme: 'system' }); assert.strictEqual((await dbSettings()).themeMode, 'system');
    });

    // ============================================================ B. PIN preference rules
    console.log('\nB. Settings: PIN lock rules');
    await resetData();
    await test('turn ON with NO PIN → blocked with a clear message; nothing saved; app does not claim protection', async () => {
        await openSettings(); const before = await snapshot(); dialogs.length = 0;
        await savePrefs({ enable: true, pin: '' });
        assert.ok(dialogs.some(m => /4-digit PIN/.test(m)), JSON.stringify(dialogs)); assert.ok(!dialogs.some(m => /Preferences saved/.test(m)), 'must not say saved');
        assert.strictEqual(await snapshot(), before); const s = await dbSettings(); assert.strictEqual(s.pinEnabled, false);
    });
    await test('a blocked attempt must not leak into memory: the NEXT "Save Profile" must not persist pinEnabled=true', async () => {
        await openSettings(); await savePrefs({ enable: true, pin: '' });
        assert.strictEqual(await ev(() => window.AppState.settings.pinEnabled), false, 'in-memory state was mutated by the blocked attempt');
        await ev(() => document.getElementById('saveProfileBtn').click()); await sleep(300); assert.strictEqual((await dbSettings()).pinEnabled, false);
    });
    for (const bad of ['12', 'abcd', '12a4', '123']) {
        await test(`invalid PIN "${bad}" → blocked ("exactly 4 digits"); the theme choice in the same form is NOT saved either`, async () => {
            await openSettings(); const before = await snapshot(); dialogs.length = 0;
            await savePrefs({ theme: 'dark', enable: true, pin: bad });
            assert.ok(dialogs.some(m => /exactly 4 digits/.test(m)), JSON.stringify(dialogs)); assert.strictEqual(await snapshot(), before);
            assert.notStrictEqual(await theme(), 'dark');
        });
    }
    await test('valid PIN + ON → saved; message says the lock is ON; after reload the lock screen appears; wrong PIN rejected; right PIN unlocks', async () => {
        await openSettings(); dialogs.length = 0; await savePrefs({ enable: true, pin: '2468' });
        assert.ok(dialogs.some(m => /Preferences saved/.test(m) && /PIN lock is ON/.test(m)), JSON.stringify(dialogs));
        const s = await dbSettings(); assert.strictEqual(s.pinEnabled, true); assert.strictEqual(s.pin, '2468');
        await load(); assert.strictEqual(await lockShown(), true);
        await typePin('1111'); assert.strictEqual(await ev(() => document.getElementById('pinError').textContent), 'Incorrect PIN'); await sleep(1000);
        await typePin('2468'); assert.strictEqual(await lockShown(), false);
        assert.strictEqual(await ev(() => document.querySelector('.page.active') && document.querySelector('.page.active').id), 'page-dashboard');
    });
    await test('turn OFF → message says OFF; no lock after reload; the stored PIN is kept (unchanged behaviour)', async () => {
        await openSettings(); dialogs.length = 0; await savePrefs({ enable: false });
        assert.ok(dialogs.some(m => /PIN lock is OFF/.test(m)), JSON.stringify(dialogs)); const s = await dbSettings(); assert.strictEqual(s.pinEnabled, false); assert.strictEqual(s.pin, '2468');
        await load(); assert.strictEqual(await lockShown(), false);
    });
    await test('turn ON again leaving the field blank re-uses the stored PIN', async () => {
        await openSettings(); await savePrefs({ enable: true, pin: '' }); const s = await dbSettings(); assert.strictEqual(s.pinEnabled, true); assert.strictEqual(s.pin, '2468');
        await load(); assert.strictEqual(await lockShown(), true); await typePin('2468'); assert.strictEqual(await lockShown(), false);
    });
    await test('changing the PIN while ON: new PIN works, old PIN is rejected', async () => {
        await openSettings(); await savePrefs({ enable: true, pin: '1357' }); assert.strictEqual((await dbSettings()).pin, '1357');
        await load(); await typePin('2468'); assert.strictEqual(await lockShown(), true, 'old PIN must not unlock'); await sleep(1000); await typePin('1357'); assert.strictEqual(await lockShown(), false);
    });
    await test('PIN field is emptied after a successful save (the PIN is never left on screen)', async () => {
        await openSettings(); await savePrefs({ enable: true, pin: '8642' }); assert.strictEqual(await ev(() => document.getElementById('set-appPin').value), '');
    });
    await test('broken legacy state (pinEnabled=true but no usable PIN): Settings shows the truth (OFF + warning) and Save repairs it', async () => {
        await putSettings({ pinEnabled: true, pin: '' }); await load(); assert.strictEqual(await lockShown(), false, 'app was never locked in this state');
        await openSettings();
        const st = await ev(() => ({ checked: document.getElementById('set-pinEnabled').checked, warn: (() => { const w = document.getElementById('pinWarning'); return w && getComputedStyle(w).display !== 'none' ? w.textContent.trim() : null; })() }));
        assert.strictEqual(st.checked, false); assert.ok(st.warn && /not active/i.test(st.warn), JSON.stringify(st));
        await savePrefs({ enable: false }); assert.strictEqual((await dbSettings()).pinEnabled, false);
        assert.strictEqual(await ev(() => { const w = document.getElementById('pinWarning'); return getComputedStyle(w).display; }), 'none');
    });
    await test('a healthy PIN setup shows NO warning', async () => {
        await putSettings({ pinEnabled: true, pin: '2468' }); await load(); await typePin('2468'); await openSettings();
        assert.strictEqual(await ev(() => getComputedStyle(document.getElementById('pinWarning')).display), 'none'); assert.strictEqual(await ev(() => document.getElementById('set-pinEnabled').checked), true);
    });
    await test('database failure while saving preferences: clear message, memory and database both unchanged', async () => {
        await putSettings({ pinEnabled: false, pin: '', themeMode: 'light' }); await load(); await openSettings(); const before = await snapshot(); dialogs.length = 0; pageErrors.length = 0;
        await ev(() => { window.__put = window.appDB.put; window.appDB.put = async () => { throw new Error('injected write failure'); }; });
        await savePrefs({ theme: 'dark', enable: true, pin: '5555' });
        await ev(() => { window.appDB.put = window.__put; });
        assert.ok(dialogs.some(m => /could not be saved/i.test(m)), JSON.stringify(dialogs)); assert.ok(!dialogs.some(m => /Preferences saved/.test(m)));
        assert.strictEqual(await snapshot(), before); const mem = await ev(() => ({ t: AppState.settings.themeMode, p: AppState.settings.pin, e: AppState.settings.pinEnabled }));
        assert.deepStrictEqual(mem, { t: 'light', p: '', e: false }); assert.strictEqual(await theme(), 'light');
        assert.deepStrictEqual(pageErrors, [], 'no uncaught error: ' + pageErrors.join(' | '));
    });

    // ============================================================ C. Reports empty / error states
    console.log('\nC. Reports: empty states and error state');
    await resetData(false);
    await test('empty database → real ₹0.00 numbers PLUS a clear "no data yet" message (not a broken-looking page)', async () => {
        await openReports(); const v = await repVals(); const n = await repNotice();
        assert.strictEqual(money(v.rev), 0); assert.strictEqual(money(v.exp), 0); assert.strictEqual(money(v.net), 0);
        assert.ok(n && n.kind === 'info' && /No business data recorded yet/.test(n.text), JSON.stringify(n));
        assert.ok(!/Loading|\.\.\./.test(Object.values(v).join(' ')), JSON.stringify(v));
    });
    await test('only a client exists → no notice (zero revenue is a real number here)', async () => {
        await ev(() => window.appDB.put('clients', { id: 'c1', name: 'Solo', status: 'Active', dateAdded: '2026-09-01T00:00:00.000Z' })); await openReports();
        assert.strictEqual(await repNotice(), null); assert.strictEqual((await repVals()).clients.trim(), '1');
    });
    await resetData();
    await test('with data and no filter: real numbers (revenue 300+100, expenses 70+50), no notice', async () => {
        await openReports(); const v = await repVals(); assert.strictEqual(money(v.rev), 400); assert.strictEqual(money(v.exp), 120); assert.strictEqual(money(v.net), 280);
        assert.strictEqual(v.clients.trim(), '3'); assert.strictEqual(v.projects.trim(), '2'); assert.strictEqual(v.quotes.trim(), '2'); assert.strictEqual(await repNotice(), null);
    });
    await test('Sep filter: only September data is counted, no notice', async () => {
        await applyFilter(...SEP); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent)); const v = await repVals();
        assert.strictEqual(money(v.rev), 300); assert.strictEqual(money(v.exp), 70); assert.strictEqual(money(v.net), 230); assert.strictEqual(v.clients.trim(), '2'); assert.strictEqual(v.projects.trim(), '1'); assert.strictEqual(v.quotes.trim(), '1');
        assert.strictEqual(await repNotice(), null);
    });
    await test('undated records are always shown by the filter (unchanged rule), so a page that still shows one is NOT "empty": real numbers, no notice', async () => {
        await applyFilter('2030-01-01', '2030-12-31'); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent));
        const v = await repVals(); assert.strictEqual(v.clients.trim(), '1', 'the undated client is still counted'); assert.strictEqual(money(v.rev), 0); assert.strictEqual(await repNotice(), null);
        await clearFilter();
    });
    await test('filter that matches nothing → "No records in the selected date range … Clear the date filter" (data is NOT missing)', async () => {
        await ev(() => window.appDB.delete('clients', 'cNoDate'));   // no undated record left: now NOTHING can be shown
        await applyFilter('2030-01-01', '2030-12-31'); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent)); const n = await repNotice(); const v = await repVals();
        assert.ok(n && /No records in the selected date range/.test(n.text) && /Clear the date filter/.test(n.text), JSON.stringify(n)); assert.ok(!/No business data recorded yet/.test(n.text));
        assert.strictEqual(money(v.rev), 0);
    });
    await test('clearing the filter removes the notice and restores the numbers', async () => {
        await clearFilter(); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent)); assert.strictEqual(await repNotice(), null); assert.strictEqual(money((await repVals()).rev), 400);
    });
    await test('database error: ALL six figures leave the loading state, a visible error message appears, nothing throws, and the app keeps working', async () => {
        pageErrors.length = 0;
        await ev(() => { window.__ga = window.appDB.getAll; window.appDB.getAll = async (s) => { if (s === 'payments') throw new Error('injected read failure'); return window.__ga.call(window.appDB, s); }; });
        await go('reports'); await sleep(500); const v = await repVals(); const n = await repNotice();
        await ev(() => { window.appDB.getAll = window.__ga; });
        Object.entries(v).forEach(([k, t]) => { assert.ok(t.trim() && !/Loading/.test(t) && t.trim() !== '...', `${k} stuck: "${t}"`); });
        assert.ok(n && n.kind === 'error' && n.role === 'alert' && /could not be loaded/i.test(n.text) && /not affected/i.test(n.text), JSON.stringify(n));
        assert.deepStrictEqual(pageErrors, []); await openReports(); assert.strictEqual(money((await repVals()).rev), 400); assert.strictEqual(await repNotice(), null);
    });
    await test('Reports still read the five stores in parallel (Promise.all structure unchanged)', async () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/views/reports_settings.js'), 'utf8'); const i = src.indexOf("addRoute('reports'"); const j = src.indexOf("addRoute('settings'");
        const block = src.slice(i, j); assert.ok(/Promise\.all\(\[/.test(block) && (block.match(/window\.appDB\.getAll\('/g) || []).length === 5 && /try \{/.test(block) && /catch \(e\)/.test(block) && /'Loading\.\.\.'/.test(block));
    });

    // ============================================================ D. CSV export honours the date filter
    console.log('\nD. CSV export with the date filter (JSON backup is always complete)');
    await resetData(); await go('data'); await wait('#exportJsonBtn');
    await test('no filter: the Data page says so, and every CSV has every record', async () => {
        const note = await ev(() => { const n = document.getElementById('dataFilterNote'); return n ? n.textContent : null; }); assert.ok(note && /No date filter/.test(note) && /every record/.test(note), note);
        for (const s of Object.keys(IDS)) { const r = await csv(s); assert.deepStrictEqual(r.ids.sort(), IDS[s].slice().sort(), s); }
    });
    await applyFilter(...SEP); await go('data'); await wait('#exportJsonBtn');
    await test('filter ON: the Data page states the range and that CSV is filtered but JSON is complete', async () => {
        const note = await ev(() => { const n = document.getElementById('dataFilterNote'); return n ? n.textContent : null; });
        assert.ok(note && /Date filter is ON/.test(note) && /2026-09-01 → 2026-09-30/.test(note) && /JSON backup is always complete/.test(note), note);
    });
    for (const s of Object.keys(IDS)) {
        await test(`filter ON: ${s} CSV contains ONLY records in range (${IN_RANGE[s].join(', ')}) and the message says "X of Y"`, async () => {
            const r = await csv(s); assert.ok(r.file, 'no file'); assert.deepStrictEqual(r.ids.sort(), IN_RANGE[s].slice().sort());
            assert.ok(r.status && new RegExp(`${IN_RANGE[s].length} of ${IDS[s].length} record\\(s\\) in the selected date range \\(2026-09-01 → 2026-09-30\\)`).test(r.status.text), JSON.stringify(r.status));
        });
    }
    await test('a record WITHOUT any date is kept by the filter (same rule as the on-screen lists) and stays exportable', async () => {
        const r = await csv('clients'); assert.ok(r.ids.includes('cNoDate'));
    });
    await test('records exist but none is in range → a DIFFERENT message than "list is empty", no file, data untouched', async () => {
        await applyFilter('2030-01-01', '2030-12-31'); await go('data'); await wait('#exportJsonBtn'); const before = await snapshot(); const r = await csv('payments');
        assert.strictEqual(r.file, null); assert.ok(r.status && /No Payments records match the selected date range/.test(r.status.text) && /2 records exist outside it/.test(r.status.text) && /Clear the date filter/.test(r.status.text), JSON.stringify(r.status));
        assert.ok(!/list is empty/.test(r.status.text)); assert.strictEqual(await snapshot(), before);
    });
    await test('EMPTY store with a filter active → the "list is empty" message (not the range message)', async () => {
        await ev(() => window.appDB.clear('expenses')); const r = await csv('expenses'); assert.strictEqual(r.file, null);
        assert.ok(/No Expenses records to export — this list is empty/.test(r.status.text) && !/date range/.test(r.status.text), JSON.stringify(r.status));
    });
    await resetData(); await applyFilter(...SEP); await go('data'); await wait('#exportJsonBtn');
    await test('JSON backup with a filter ACTIVE is still COMPLETE (all records) and the message says the filter was not applied', async () => {
        cleanDl(); await ev(() => document.getElementById('exportJsonBtn').click()); const f = await waitFile(/^AutomationManager_Backup_.*\.json$/); assert.ok(f, 'no backup');
        const j = JSON.parse(fs.readFileSync(f, 'utf8')); Object.keys(IDS).forEach(s => assert.deepStrictEqual(j[s].map(x => x.id).sort(), IDS[s].slice().sort(), s + ' incomplete'));
        await sleep(300); const st = await dataStatus(); assert.ok(/date filter is NOT applied to backups/i.test(st.text), st.text);
    });
    await test('applying / clearing the filter from the drawer updates the Data page note', async () => {
        await clearFilter(); assert.ok(/No date filter/.test(await ev(() => document.getElementById('dataFilterNote').textContent)));
        await applyFilter(...SEP); assert.ok(/Date filter is ON/.test(await ev(() => document.getElementById('dataFilterNote').textContent)));
    });
    await test('a filter with only a start date is described as "from …"', async () => {
        await applyFilter('2026-09-01', ''); assert.ok(/from 2026-09-01/.test(await ev(() => document.getElementById('dataFilterNote').textContent)));
        const r = await csv('payments'); assert.deepStrictEqual(r.ids, ['pIn']);
    });
    await test('CSV quoting/BOM from Phase 1 is unchanged with a filter (BOM present, UTF-8)', async () => {
        await clearFilter(); cleanDl(); await ev(() => document.querySelector('[data-csv="clients"]').click()); const f = await waitFile(/\.csv$/); const b = fs.readFileSync(f);
        assert.deepStrictEqual([...b.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
    });

    // ============================================================ E. regression
    console.log('\nE. Regression');
    await resetData();
    await test('all 14 routes render without exceptions', async () => {
        pageErrors.length = 0; const routes = await ev(() => Object.keys(window.appRouter.routes)); assert.strictEqual(routes.length, 14);
        for (const r of routes) { const ok = await ev(async r => { try { await window.appRouter.navigate(r); return document.getElementById('page-' + r).classList.contains('active'); } catch (e) { return String(e); } }, r); assert.strictEqual(ok, true, r + ': ' + ok); }
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('Settings: Save Profile / Pricing / AI credentials still persist across reload', async () => {
        await openSettings(); await ev(() => { document.getElementById('set-agencyName').value = 'P4 Agency'; document.getElementById('saveProfileBtn').click(); }); await sleep(250);
        await ev(() => { document.getElementById('set-taxRate').value = '12'; document.getElementById('savePricingBtn').click(); }); await sleep(250);
        await ev(() => { document.getElementById('set-aiApiKeyGemini').value = 'KEY-P4'; document.getElementById('saveAiBtn').click(); }); await sleep(250); await load();
        const s = await dbSettings(); assert.strictEqual(s.agencyName, 'P4 Agency'); assert.strictEqual(Number(s.taxRate), 12); assert.strictEqual(s.aiApiKeyGemini, 'KEY-P4');
    });
    await test('Phase 1 safety intact: the JSON backup still contains no API key / PIN', async () => {
        await putSettings({ pin: '2468', pinEnabled: false }); await go('data'); await wait('#exportJsonBtn'); cleanDl(); await ev(() => document.getElementById('exportJsonBtn').click());
        const f = await waitFile(/^AutomationManager_Backup_.*\.json$/); const txt = fs.readFileSync(f, 'utf8'); assert.ok(!/KEY-P4|2468/.test(txt) && !/"pin"\s*:/.test(txt));
    });
    await test('no uncaught page errors during the whole run', async () => { assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n')); });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 4 browser tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failures.length) console.log('FAILED: ' + failures.join(' | '));
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
