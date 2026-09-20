// Phase 2 browser tests: real Chromium + timezone emulation + a controllable clock + real forms / downloads / IndexedDB.
//   PUPPETEER_CORE=/path/to/puppeteer-core CHROME_PATH=/path/to/chrome [APP_ROOT=/path/to/app] node tests/phase2_browser.test.js
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

// ---- independent calendar oracle (no JS Date arithmetic) ----
const pad = (n, w) => String(n).padStart(w || 2, '0');
const fmt = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function addDays({ y, m, d }, n) {
    while (n > 0) { d++; if (d > dim(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } } n--; }
    while (n < 0) { d--; if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = dim(y, m); } n++; }
    return { y, m, d };
}
function daysFromCivil(y, m, d) { y -= m <= 2 ? 1 : 0; const era = Math.floor(y / 400), yoe = y - era * 400; const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468; }
const weekday = ({ y, m, d }) => (((daysFromCivil(y, m, d) + 4) % 7) + 7) % 7;
function localYmd(ms, tz) { const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return { y: +p.year, m: +p.month, d: +p.day }; }
function expectedPreset(preset, t) {
    const dow = weekday(t);
    switch (preset) {
        case 'today': return [fmt(t), fmt(t)];
        case 'yesterday': return [fmt(addDays(t, -1)), fmt(addDays(t, -1))];
        case 'this_week': return [fmt(addDays(t, -dow)), fmt(t)];
        case 'last_week': return [fmt(addDays(t, -(dow + 7))), fmt(addDays(t, -(dow + 1)))];
        case 'this_month': return [fmt({ y: t.y, m: t.m, d: 1 }), fmt(t)];
        case 'last_month': { const pm = t.m === 1 ? { y: t.y - 1, m: 12 } : { y: t.y, m: t.m - 1 }; return [fmt({ y: pm.y, m: pm.m, d: 1 }), fmt({ y: pm.y, m: pm.m, d: dim(pm.y, pm.m) })]; }
        case 'this_year': return [fmt({ y: t.y, m: 1, d: 1 }), fmt(t)];
        case 'last_year': return [fmt({ y: t.y - 1, m: 1, d: 1 }), fmt({ y: t.y - 1, m: 12, d: 31 })];
    }
}
const PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year'];

let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 6).join('\n      ')); }
}

(async () => {
    const { srv, port } = await startServer();
    const BASE = 'http://localhost:' + port + '/index.html';
    const DL = fs.mkdtempSync('/tmp/p2dl-');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900 });
    if (page.setBypassServiceWorker) await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', r => { if (/cdn\.jsdelivr\.net/.test(r.url())) r.abort(); else r.continue(); });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
        // controllable clock: while window.__NOW is a number, "now" is that instant
        const R = Date; window.__NOW = null;
        class D extends R {
            constructor(...a) { if (a.length === 0 && window.__NOW !== null) super(window.__NOW); else super(...a); }
            static now() { return window.__NOW !== null ? window.__NOW : R.now(); }
        }
        window.Date = D;
    });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept());
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const setNow = (iso) => ev(ms => { window.__NOW = ms; }, iso === null ? null : Date.parse(iso));
    async function load() { await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.AppState && window.AppState.settings && window.appRouter, { timeout: 10000 }); }
    const ALL = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
    const wipe = () => ev(async (stores) => { for (const s of stores) await window.appDB.clear(s); localStorage.clear(); }, ALL);
    const put = (store, rec) => ev((s, r) => window.appDB.put(s, r), store, rec);
    function cleanDl() { fs.readdirSync(DL).forEach(f => fs.rmSync(path.join(DL, f), { force: true })); }
    async function waitFile(re, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = fs.readdirSync(DL).filter(x => re.test(x) && !x.endsWith('.crdownload')); if (f.length) return f[0]; await sleep(100); } return null; }

    await load();
    console.log('\nApp under test: ' + ROOT + '  (getDatePresetRange present: ' + await ev(() => typeof window.getDatePresetRange) + ')');

    // =============================================================== A. filter presets — every timezone × instant
    console.log('\nA. Global-filter presets in the real drawer (clock + timezone emulated)');
    const ZONES = ['Asia/Kolkata', 'Pacific/Auckland', 'America/New_York', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Australia/Lord_Howe', 'America/Sao_Paulo', 'Asia/Kathmandu'];
    const INSTANTS = ['2026-09-18T20:30:00Z', '2026-09-19T04:30:00Z', '2026-09-30T18:45:00Z', '2026-12-31T19:00:00Z', '2026-03-01T00:30:00Z', '2026-01-01T03:00:00Z', '2026-09-20T12:00:00Z', '2028-02-29T23:30:00Z'];
    for (const tz of ZONES) {
        await test(`presets correct in ${tz} at ${INSTANTS.length} instants × 8 presets`, async () => {
            await page.emulateTimezone(tz); const bad = []; let n = 0;
            await ev(() => document.querySelector('.global-filter-btn').click());
            for (const iso of INSTANTS) {
                await setNow(iso); const t = localYmd(Date.parse(iso), tz);
                for (const p of PRESETS) {
                    await page.select('#filterPreset', p);
                    const got = await ev(() => [document.getElementById('filterFromDate').value, document.getElementById('filterToDate').value]);
                    const exp = expectedPreset(p, t); n++;
                    if (got[0] !== exp[0] || got[1] !== exp[1]) bad.push(`${iso} ${p}: got ${got.join('..')} expected ${exp.join('..')}`);
                }
            }
            await setNow(null);
            assert.strictEqual(bad.length, 0, `${bad.length}/${n} wrong. e.g.\n${bad.slice(0, 3).join('\n')}`);
        });
    }
    await test('choosing "Custom" never overwrites dates the user typed', async () => {
        await page.emulateTimezone('Asia/Kolkata'); await setNow('2026-09-19T04:30:00Z');
        await ev(() => { document.getElementById('filterFromDate').value = '2020-02-02'; document.getElementById('filterToDate').value = '2020-03-03'; });
        await page.select('#filterPreset', 'custom');
        assert.deepStrictEqual(await ev(() => [filterFromDate.value, filterToDate.value]), ['2020-02-02', '2020-03-03']); await setNow(null);
    });

    // =============================================================== B. "today" in forms and file names
    console.log('\nB. Default dates in forms + backup/CSV file names use the LOCAL date');
    await wipe(); await load(); await page.emulateTimezone('Asia/Kolkata');
    await put('clients', { id: 'c1', name: 'Acme', status: 'Active', dateAdded: '2026-09-01T00:00:00.000Z' });
    for (const [tz, iso, label, local] of [['Asia/Kolkata', '2026-09-18T20:30:00Z', '02:00 IST on Sep 19', '2026-09-19'], ['America/New_York', '2026-09-20T03:30:00Z', '23:30 New York on Sep 19', '2026-09-19'], ['Pacific/Kiritimati', '2026-09-18T11:00:00Z', '01:00 Kiritimati on Sep 19', '2026-09-19']]) {
        await test(`${label}: all 5 forms default to ${local} (never the UTC date)`, async () => {
            await page.emulateTimezone(tz); await setNow(iso);
            const dateOf = async (route, btn, sel) => { await ev(r => window.appRouter.navigate(r), route); await page.waitForSelector(btn); await ev(b => document.querySelector(b).click(), btn); await page.waitForSelector(sel); return ev(s => document.querySelector(s).value, sel); };
            const got = {
                quote: await dateOf('quotes', '#newQuoteBtn', '#qf-date'), invoice: await dateOf('invoices', '#newInvBtn', '#if-date'), payment: await dateOf('payments', '#newPayBtn', '#pf-date'),
                expense: await dateOf('expenses', '#newExpBtn', '#ef-date'), project: await dateOf('projects', '#newProjectBtn', '#pf-start')
            };
            await setNow(null);
            assert.deepStrictEqual(got, { quote: local, invoice: local, payment: local, expense: local, project: local });
        });
        await test(`${label}: JSON backup and CSV file names carry ${local}`, async () => {
            await page.emulateTimezone(tz); await setNow(iso); cleanDl();
            await ev(() => window.appRouter.navigate('data')); await page.waitForSelector('#exportJsonBtn');
            await ev(() => document.getElementById('exportJsonBtn').click()); const j = await waitFile(/^AutomationManager_Backup_.*\.json$/);
            await ev(() => document.querySelector('[data-csv="clients"]').click()); const c = await waitFile(/^Automation_clients_.*\.csv$/); await setNow(null);
            assert.strictEqual(j, `AutomationManager_Backup_${local}.json`); assert.strictEqual(c, `Automation_clients_${local}.csv`);
        });
    }

    // =============================================================== C. filter applied end-to-end with a preset
    console.log('\nC. A preset applied to real data selects the right records');
    await page.emulateTimezone('Asia/Kolkata'); await wipe(); await load(); await page.emulateTimezone('Asia/Kolkata');
    await put('payments', { id: 'p1', invoiceId: 'x', amount: 1000, date: '2026-09-06' }); await put('payments', { id: 'p2', invoiceId: 'x', amount: 500, date: '2026-08-31' });
    await put('expenses', { id: 'e1', name: 'Hosting', amount: 200, date: '2026-09-07' }); await put('expenses', { id: 'e2', name: 'Ads', amount: 300, date: '2026-08-31' });
    await put('payments', { id: 'p3', invoiceId: 'x', amount: 7, date: '2026-07-31' });
    async function reportsWithPreset(preset, iso) {
        await setNow(iso); await ev(() => window.appRouter.navigate('reports')); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent));
        await ev(() => document.querySelector('.global-filter-btn').click()); await page.select('#filterPreset', preset);
        await ev(() => document.getElementById('applyFilterBtn').click());
        await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent)); await sleep(150);
        const r = await ev(() => ({ rev: repRev.textContent, exp: repExp.textContent })); await ev(() => document.getElementById('clearFilterBtn') && (AppFilter.clear())); await setNow(null);
        const num = s => Number(s.replace(/[^0-9.]/g, '')); return { rev: num(r.rev), exp: num(r.exp) };
    }
    await test('"This month" on Sep 19 (IST): revenue 1000 / expenses 200 — the Aug 31 items are NOT included', async () => {
        const r = await reportsWithPreset('this_month', '2026-09-19T04:30:00Z'); assert.deepStrictEqual(r, { rev: 1000, exp: 200 });
    });
    await test('"Last month" on Sep 19 (IST): the whole of August incl. Aug 31 → revenue 500 / expenses 300', async () => {
        const r = await reportsWithPreset('last_month', '2026-09-19T04:30:00Z'); assert.deepStrictEqual(r, { rev: 500, exp: 300 });
    });
    await test('"This month" at 00:15 IST on Oct 1 (UTC is still Sep 30): Oct 1 onwards → nothing yet', async () => {
        const r = await reportsWithPreset('this_month', '2026-09-30T18:45:00Z'); assert.deepStrictEqual(r, { rev: 0, exp: 0 });
    });
    await test('"Today" applied at 02:00 IST is today, not yesterday (record dated the local day is found)', async () => {
        await put('payments', { id: 'p4', invoiceId: 'x', amount: 42, date: '2026-09-19' });
        const r = await reportsWithPreset('today', '2026-09-18T20:30:00Z'); assert.strictEqual(r.rev, 42);
    });

    // =============================================================== D. settings defaults in the real app
    console.log('\nD. Settings defaults merge (real IndexedDB, real reload)');
    const DEFAULT_COUNT = 29;
    await test('first run on an empty database creates and persists the complete default settings', async () => {
        await wipe(); await load();
        const s = await ev(async () => ({ mem: Object.keys(AppState.settings).length, db: Object.keys(await appDB.get('settings', 'appSettings')).length, name: AppState.settings.agencyName }));
        assert.strictEqual(s.mem, DEFAULT_COUNT); assert.strictEqual(s.db, DEFAULT_COUNT); assert.strictEqual(s.name, 'Your Agency');
    });
    await test('PARTIAL stored settings (migration/backup shape): app gets every default in memory, DB record untouched, stored values win', async () => {
        await wipe(); await put('settings', { id: 'appSettings', migrated_v1: true, agencyName: 'Partial Co', taxRate: 0, themeMode: 'dark' }); await load();
        const s = await ev(async () => ({ mem: Object.keys(AppState.settings).length, tax: AppState.settings.taxRate, name: AppState.settings.agencyName, cur: AppState.settings.currency,
            del: AppState.settings.deliverables.length, dbKeys: Object.keys(await appDB.get('settings', 'appSettings')).sort(), theme: document.documentElement.dataset.theme, mig: AppState.settings.migrated_v1 }));
        assert.ok(s.mem >= DEFAULT_COUNT); assert.strictEqual(s.tax, 0, 'stored taxRate 0 must win over the default 18'); assert.strictEqual(s.name, 'Partial Co');
        assert.strictEqual(s.cur, '₹'); assert.strictEqual(s.del, 3); assert.strictEqual(s.theme, 'dark'); assert.strictEqual(s.mig, true);
        assert.deepStrictEqual(s.dbKeys, ['agencyName', 'id', 'migrated_v1', 'taxRate', 'themeMode'], 'loadSettings must not rewrite the stored record');
    });
    await test('Settings page shows real values for every field (no "undefined") with partial stored settings', async () => {
        await ev(() => window.appRouter.navigate('settings')); await page.waitForSelector('#set-agencyName');
        const vals = await ev(() => [...document.querySelectorAll('#page-settings input, #page-settings select')].map(e => [e.id, e.value]).filter(([id]) => id));
        assert.ok(vals.length >= 8); vals.forEach(([id, v]) => assert.ok(v !== 'undefined' && v !== 'null', id + '=' + v));
        const byId = Object.fromEntries(vals); assert.strictEqual(byId['set-invoicePrefix'], 'INV'); assert.strictEqual(byId['set-currency'], '₹'); assert.strictEqual(byId['set-taxRate'], '0');
    });
    await test('saving from Settings persists the COMPLETE record (defaults + stored values)', async () => {
        await ev(() => { document.getElementById('set-agencyName').value = 'Renamed Co'; document.getElementById('saveProfileBtn').click(); }); await sleep(300);
        const db = await ev(() => appDB.get('settings', 'appSettings'));
        assert.ok(Object.keys(db).length >= DEFAULT_COUNT); assert.strictEqual(db.agencyName, 'Renamed Co'); assert.strictEqual(db.taxRate, 0); assert.strictEqual(db.themeMode, 'dark'); assert.strictEqual(db.migrated_v1, true);
    });
    await test('settings WITHOUT deliverables no longer crash the New Quote form (the original threw)', async () => {
        await wipe(); await put('settings', { id: 'appSettings', agencyName: 'No Deliverables Co' }); await load(); pageErrors.length = 0;
        await ev(() => window.appRouter.navigate('quotes')); await page.waitForSelector('#newQuoteBtn'); await ev(() => document.getElementById('newQuoteBtn').click());
        await page.waitForSelector('#qf-date', { timeout: 3000 });
        const boxes = await ev(() => document.querySelectorAll('#qf-deliverables input[type=checkbox], input[name="deliverable"], #page-quotes input[type=checkbox]').length);
        assert.ok(boxes >= 3, 'deliverable checkboxes rendered: ' + boxes); assert.deepStrictEqual(pageErrors, []);
    });
    await test('corrupt deliverables (a string) is repaired in memory; Settings page and quote form still work', async () => {
        await wipe(); await put('settings', { id: 'appSettings', deliverables: 'oops' }); await load(); pageErrors.length = 0;
        assert.strictEqual(await ev(() => Array.isArray(AppState.settings.deliverables)), true);
        await ev(() => window.appRouter.navigate('settings')); await page.waitForSelector('#set-deliverablesList'); assert.deepStrictEqual(pageErrors, []);
    });
    await test('Phase 1 + 2 chain: legacy localStorage migration → reload → legacy values kept, missing fields defaulted', async () => {
        await wipe(); const legacy = { settings: { agencyName: 'Old Agency', taxRate: 12, currency: '$', darkMode: true }, quotes: [{ id: 'lq1', clientName: 'Acme', invoice: 'INV-1', date: '2024-01-01' }] };
        await ev(l => localStorage.setItem('automation_pricing_app_v1', JSON.stringify(l)), legacy); await load();
        const s = await ev(() => ({ n: AppState.settings.agencyName, t: AppState.settings.taxRate, c: AppState.settings.currency, th: document.documentElement.dataset.theme, phone: AppState.settings.phone, q: AppState.settings.quotePrefix, len: Object.keys(AppState.settings).length, mig: AppState.settings.migrated_v1 }));
        assert.deepStrictEqual([s.n, s.t, s.c, s.th, s.phone, s.q, s.mig], ['Old Agency', 12, '$', 'dark', '', 'QT', true]); assert.ok(s.len >= DEFAULT_COUNT);
    });
    await test('Phase 1 + 2 chain: restoring a backup whose settings lack newer fields → complete settings after reload, local API key kept', async () => {
        await wipe(); await load(); await ev(async () => { const s = await appDB.get('settings', 'appSettings'); s.aiApiKeyGemini = 'LOCAL-KEY'; await appDB.put('settings', s); });
        const has = await ev(() => typeof window.BackupTools);
        if (has !== 'object') return; // original app has no restore feature
        const backup = await ev(async () => { const all = {}; for (const s of BackupTools.STORES) all[s] = []; all.settings = [{ id: 'appSettings', agencyName: 'From Backup' }]; return BackupTools.buildBackupObject(all); });
        await ev(async (b) => { await BackupTools.replaceAllStores(b, {}); }, backup); await load();
        const s = await ev(() => ({ n: AppState.settings.agencyName, k: AppState.settings.aiApiKeyGemini, len: Object.keys(AppState.settings).length, del: AppState.settings.deliverables.length }));
        assert.strictEqual(s.n, 'From Backup'); assert.strictEqual(s.k, 'LOCAL-KEY'); assert.ok(s.len >= DEFAULT_COUNT); assert.strictEqual(s.del, 3);
    });

    // =============================================================== E. regression
    console.log('\nE. Regression');
    await wipe(); await load(); await page.emulateTimezone('Asia/Kolkata');
    await test('all 14 routes still render without exceptions', async () => {
        pageErrors.length = 0; const routes = await ev(() => Object.keys(window.appRouter.routes)); assert.strictEqual(routes.length, 14);
        for (const r of routes) { const ok = await ev(async r => { try { await window.appRouter.navigate(r); return document.getElementById('page-' + r).classList.contains('active'); } catch (e) { return String(e); } }, r); assert.strictEqual(ok, true, r + ': ' + ok); }
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('custom From/To filter still filters (unchanged filterDataByDate)', async () => {
        await put('payments', { id: 'r1', amount: 10, date: '2026-09-10' }); await put('payments', { id: 'r2', amount: 90, date: '2026-09-25' });
        await ev(() => window.appRouter.navigate('reports')); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent));
        await ev(() => document.querySelector('.global-filter-btn').click());
        await ev(() => { filterFromDate.value = '2026-09-20'; filterToDate.value = '2026-09-30'; document.getElementById('applyFilterBtn').click(); });
        await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent)); await sleep(150);
        assert.strictEqual(Number((await ev(() => repRev.textContent)).replace(/[^0-9.]/g, '')), 90);
        await ev(() => { AppFilter.clear(); });
    });
    await test('theme toggle still persists themeMode across reload', async () => {
        await ev(() => document.getElementById('themeBtn').click()); await sleep(300); const m = await ev(() => AppState.settings.themeMode); await load();
        assert.strictEqual(await ev(() => AppState.settings.themeMode), m); assert.ok(['dark', 'light'].includes(m));
    });
    await test('no uncaught page errors during the whole run', async () => { assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n')); });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 2 browser tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failures.length) console.log('FAILED: ' + failures.join(' | '));
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
