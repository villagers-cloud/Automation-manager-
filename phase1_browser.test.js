// Phase 1 browser tests: real Chromium + real IndexedDB + real UI clicks + real file downloads.
// Needs puppeteer-core and a Chromium binary:
//   PUPPETEER_CORE=/path/to/puppeteer-core  CHROME_PATH=/path/to/chrome  node tests/phase1_browser.test.js
// APP_ROOT (optional) selects which copy of the app to test (default: this project).
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

const puppeteer = require(process.env.PUPPETEER_CORE || '/home/claude/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ static server
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

// ------------------------------------------------------------------ dataset
const ALL_STORES = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
const LOCAL_SECRETS = { aiApiKeyGemini: 'AIzaSy-LOCAL-GEMINI-KEY', aiApiKeyOpenAI: 'sk-LOCAL-OPENAI-KEY', pin: '2468', pinEnabled: false };
function dataset() {
    return {
        settings: [Object.assign({ id: 'appSettings', migrated_v1: true, agencyName: 'Backup Agency ગુજરાત ₹', taxRate: 18, metaRate: 0.85, currency: '₹',
            invoicePrefix: 'INV', deliverables: ['WhatsApp Setup', 'Ads'], themeMode: 'light', phone: '+91 99999 00000', address: '12 Main Rd, Surat', aiProvider: 'gemini' }, LOCAL_SECRETS)],
        clients: [
            { id: 'c1', name: 'Acme, "Inc"', company: 'Line1\nLine2', status: 'Active', notes: null, dateAdded: '2026-09-10T05:00:00.000Z' },
            { id: 'c2', name: 'બીટા ગુજરાતી ₹ 1,500', status: 'Active', dateAdded: '2026-08-31T05:00:00.000Z', extraField: 'only here' },
            { id: 'c3', name: 'CR\rHere', status: 'Inactive', dateAdded: '2026-08-01T05:00:00.000Z', tags: ['x', 'y,z'], meta: { k: 'v', n: 1 } }
        ],
        services: [{ id: 's1', name: 'Setup', price: 1000 }],
        quotes: [
            { id: 'q1', clientId: 'c1', clientNameTemp: 'Acme', invoice: 'QT-001', date: '2026-09-05', setupFee: 1000, retainer: 500, deliverables: ['WhatsApp Setup', 'Ads'], expenses: [{ name: 'x', amount: 100, billToClient: true }], status: 'Approved', created: '2026-09-05T03:00:00.000Z' },
            { id: 'q2', clientId: 'c2', clientNameTemp: 'Beta', invoice: 'QT-002', date: '2026-08-31', setupFee: 200, retainer: 0, deliverables: [], expenses: [], status: 'Pending', created: '2026-08-31T03:00:00.000Z' }
        ],
        projects: [{ id: 'pr1', name: 'P1', clientId: 'c1', status: 'In Progress', startDate: '2026-09-01' }, { id: 'pr2', name: 'P2', clientId: 'c2', status: 'Planning', startDate: '2026-08-15' }],
        tasks: [{ id: 't1', title: 'Task', projectId: 'pr2', clientId: 'c2', status: 'Pending', dueDate: '2026-09-20' }],
        invoices: [{ id: 'i1', number: 'INV-1', date: '2026-09-05', clientId: 'c1', amount: 1500, dueDate: '2026-10-05' }],
        payments: [{ id: 'p1', invoiceId: 'i1', amount: 1000, date: '2026-09-06', method: 'UPI' }, { id: 'p2', invoiceId: 'i1', amount: 500, date: '2026-08-31', method: 'UPI' }],
        expenses: [{ id: 'e1', name: 'Hosting', amount: 200, date: '2026-09-07', category: 'Software' }, { id: 'e2', name: 'Ads', amount: 300, date: '2026-08-31', category: 'Marketing' }],
        team: [{ id: 'm1', name: 'Member One', role: 'Dev' }],
        notes: [{ id: 'n1', title: 'Note', content: 'hi', created: '2026-09-01T00:00:00.000Z' }],
        activity: []
    };
}
const stripSecrets = (settingsArr) => settingsArr.map(s => { const c = clone(s); ['aiApiKeyGemini', 'aiApiKeyOpenAI', 'pin', 'pinEnabled'].forEach(k => delete c[k]); return c; });

// ------------------------------------------------------------------ RFC 4180 parser
function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
        else if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// ------------------------------------------------------------------ harness
let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 6).join('\n      ')); }
}

(async () => {
    const { srv, port } = await startServer();
    const BASE = 'http://localhost:' + port + '/index.html';
    const DL = fs.mkdtempSync('/tmp/p1dl-');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900 });
    if (page.setBypassServiceWorker) await page.setBypassServiceWorker(true);
    await page.emulateTimezone('Asia/Kolkata');
    await page.setRequestInterception(true);
    page.on('request', r => { if (/cdn\.jsdelivr\.net/.test(r.url())) r.abort(); else r.continue(); });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    // simulate Android/unsupported browsers: no File System Access API -> anchor download path
    await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_FAILED/.test(m.text())) pageErrors.push('console.error: ' + m.text().slice(0, 200)); });

    const dialogs = [];
    let dialogHandler = () => ({ accept: true });
    page.on('dialog', async d => { const r = dialogHandler(d.message(), d.type()) || { accept: true }; dialogs.push({ type: d.type(), message: d.message(), accepted: !!r.accept }); if (r.accept) await d.accept(); else await d.dismiss(); });

    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    async function load() { await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.AppState && window.AppState.settings && window.appRouter, { timeout: 10000 }); }
    async function seed(ds) {
        await ev(async (ds, stores) => {
            for (const s of stores) await window.appDB.clear(s);
            for (const s of stores) for (const rec of (ds[s] || [])) await window.appDB.put(s, rec);
            await window.AppState.loadSettings();
        }, ds, ALL_STORES);
    }
    const snapshot = () => ev(() => initDB().then(db => new Promise((res, rej) => {
        const names = [...db.objectStoreNames].sort(); const tx = db.transaction(names, 'readonly'); const out = {};
        names.forEach(n => { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result; }; });
        tx.oncomplete = () => res(JSON.stringify(out)); tx.onerror = () => rej(tx.error);
    })));
    const snapObj = async () => JSON.parse(await snapshot());
    async function gotoData() { await ev(() => window.appRouter.navigate('data')); await page.waitForSelector('#exportJsonBtn'); await ev(() => { const s = document.getElementById('dataStatus'); s.style.display = 'none'; s.textContent = ''; }); }
    const status = () => ev(() => { const s = document.getElementById('dataStatus'); return s ? { text: s.textContent, kind: s.dataset.kind, shown: s.style.display !== 'none' } : null; });
    async function waitStatusSettled() {
        await page.waitForFunction(() => { const s = document.getElementById('dataStatus'); return s && s.style.display === 'block' && !/^(Checking|Restoring|Preparing)/.test(s.textContent); }, { timeout: 10000 });
        return status();
    }
    function cleanDl() { fs.readdirSync(DL).forEach(f => fs.rmSync(path.join(DL, f), { force: true })); }
    async function waitFile(re, ms = 6000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const f = fs.readdirSync(DL).filter(x => re.test(x) && !x.endsWith('.crdownload')); if (f.length) { await sleep(150); return path.join(DL, f[0]); } await sleep(100); }
        return null;
    }
    async function exportJson() { cleanDl(); await gotoData(); await ev(() => document.getElementById('exportJsonBtn').click()); const f = await waitFile(/^AutomationManager_Backup_.*\.json$/); await waitStatusSettled(); return f; }
    async function importFile(fp, expectReload) {
        await gotoData();
        const nav = expectReload ? page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }) : null;
        const input = await page.$('#importJsonFile'); await input.uploadFile(fp);
        if (expectReload) { await nav; await page.waitForFunction(() => window.AppState && window.AppState.settings, { timeout: 10000 }); return null; }
        return waitStatusSettled();
    }
    function writeTmp(name, obj) { const p = path.join(DL, '..', name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; }
    async function validBackupObject(ds) { return ev((all) => BackupTools.buildBackupObject(all), ds); }

    await load();
    console.log('\nApp loaded from ' + ROOT + '  (BackupTools present: ' + await ev(() => typeof window.BackupTools) + ')');

    // =================================================================== 1B. BACKUP
    console.log('\n1B. Safe JSON backup');
    let ds = dataset(); await seed(ds);
    let exported;
    await test('export writes a real .json file with all 11 stores + metadata', async () => {
        const f = await exportJson(); assert.ok(f, 'no backup file was downloaded');
        exported = fs.readFileSync(f, 'utf8'); const j = JSON.parse(exported);
        ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes'].forEach(s => assert.ok(Array.isArray(j[s]), 'missing ' + s));
        assert.strictEqual(j.meta.app, 'Automation Manager'); assert.strictEqual(j.meta.schemaVersion, 2);
        assert.ok(!isNaN(Date.parse(j.meta.exportedAt))); assert.strictEqual(j.meta.counts.clients, 3); assert.strictEqual(j.meta.dbName, 'AutomationManagerDB');
        assert.ok(j.meta.dbVersion >= 1);
    });
    await test('exported data equals what is really in IndexedDB (business stores)', async () => {
        const j = JSON.parse(exported); const snap = await snapObj();
        ['clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes'].forEach(s => assert.deepStrictEqual(j[s], snap[s], s));
        assert.deepStrictEqual(j.settings, stripSecrets(snap.settings));
    });
    await test('SECRETS ABSENT: no API key, no PIN (values or keys) anywhere in the file', async () => {
        ['AIzaSy-LOCAL-GEMINI-KEY', 'sk-LOCAL-OPENAI-KEY', '2468'].forEach(v => assert.ok(exported.indexOf(v) === -1, 'value leaked: ' + v));
        [/"pin"\s*:/, /"pinEnabled"\s*:/, /"aiApiKeyGemini"\s*:/, /"aiApiKeyOpenAI"\s*:/].forEach(re => assert.ok(!re.test(exported), 'key leaked: ' + re));
    });
    await test('UI status is honest: "created and sent to your browser", NOT "saved"; mentions keys excluded', async () => {
        const s = await status();
        assert.ok(/was created and sent/.test(s.text) && /did not confirm/.test(s.text), s.text); assert.ok(!/was saved/.test(s.text), s.text); assert.ok(/NOT included/.test(s.text));
        assert.strictEqual(s.kind, 'info');
    });
    await test('local credentials are untouched by exporting', async () => {
        const s = (await snapObj()).settings[0]; assert.strictEqual(s.aiApiKeyGemini, LOCAL_SECRETS.aiApiKeyGemini); assert.strictEqual(s.pin, '2468');
    });
    await test('export failure (database read throws) → clear error, NO file created', async () => {
        cleanDl(); await gotoData();
        await ev(() => { window.__t = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function () { throw new Error('injected read failure'); }; });
        await ev(() => document.getElementById('exportJsonBtn').click());
        const s = await waitStatusSettled();
        await ev(() => { IDBDatabase.prototype.transaction = window.__t; });
        assert.strictEqual(s.kind, 'error'); assert.ok(/Backup FAILED/.test(s.text) && /No backup file was created/.test(s.text), s.text);
        assert.strictEqual(fs.readdirSync(DL).length, 0, 'a file was created despite the failure');
    });

    // =================================================================== 1A. RESTORE — invalid inputs leave data untouched
    console.log('\n1A. Safe JSON restore — INVALID backups must leave existing data byte-identical');
    const good = await validBackupObject(ds);
    const invalidCases = [
        ['invalid JSON', '{ not json at all'],
        ['empty file', ''],
        ['JSON array instead of object', '[1,2,3]'],
        ['missing store (notes)', (() => { const b = clone(good); delete b.notes; delete b.meta; return b; })()],
        ['missing store (settings)', (() => { const b = clone(good); delete b.settings; delete b.meta; return b; })()],
        ['store is not an array (clients = {})', (() => { const b = clone(good); b.clients = {}; return b; })()],
        ['store is a string (payments)', (() => { const b = clone(good); b.payments = 'nope'; delete b.meta; return b; })()],
        ['record missing id', (() => { const b = clone(good); delete b.quotes[1].id; delete b.meta; return b; })()],
        ['record with empty id', (() => { const b = clone(good); b.expenses[0].id = ''; delete b.meta; return b; })()],
        ['malformed record (null)', (() => { const b = clone(good); b.tasks.push(null); delete b.meta; return b; })()],
        ['malformed record (string)', (() => { const b = clone(good); b.notes.push('oops'); delete b.meta; return b; })()],
        ['duplicate ids', (() => { const b = clone(good); b.clients.push({ id: 'c1', name: 'dup' }); delete b.meta; return b; })()],
        ['client without a name', (() => { const b = clone(good); b.clients.push({ id: 'c99' }); delete b.meta; return b; })()],
        ['truncated file (declared count differs)', (() => { const b = clone(good); b.clients.pop(); return b; })()],
        ['newer schema version', (() => { const b = clone(good); b.meta.schemaVersion = 99; return b; })()]
    ];
    for (const [label, content] of invalidCases) {
        await test('invalid: ' + label + ' → error shown, existing data unchanged', async () => {
            await seed(ds); const before = await snapshot();
            const fp = writeTmp('bad.json', content);
            dialogs.length = 0; const s = await importFile(fp, false);
            assert.strictEqual(s.kind, 'error', 'status: ' + s.text);
            assert.ok(/NOT changed/.test(s.text), s.text);
            assert.strictEqual(dialogs.filter(d => d.type === 'confirm').length, 0, 'confirm() must not even appear for an invalid file');
            assert.strictEqual(await snapshot(), before, 'IndexedDB CHANGED after an invalid restore');
        });
    }
    await test('same invalid file can be selected twice in a row (input is reset)', async () => {
        await seed(ds); const fp = writeTmp('bad.json', '{ nope');
        const a = await importFile(fp, false); const b = await importFile(fp, false);
        assert.strictEqual(a.kind, 'error'); assert.strictEqual(b.kind, 'error');
    });
    await test('user cancels the confirmation → nothing changes', async () => {
        await seed(ds); const before = await snapshot();
        dialogHandler = (m) => ({ accept: !/^Restore this backup/.test(m) });
        const fp = writeTmp('good.json', good); const s = await importFile(fp, false);
        dialogHandler = () => ({ accept: true });
        assert.ok(/cancelled/i.test(s.text) && /NOT changed/.test(s.text), s.text); assert.strictEqual(await snapshot(), before);
    });

    // =================================================================== 1A. transaction failures
    console.log('\n1A. Atomic restore — transaction failure must NOT partially replace data');
    async function injected(kind, backupObj) {
        return ev(async (kind, b) => {
            const P = IDBObjectStore.prototype, origPut = P.put, origClear = P.clear;
            if (kind === 'put-throws') P.put = function (v, k) { if (v && v.id === 'q-BOOM') throw new Error('injected put failure'); return origPut.call(this, v, k); };
            if (kind === 'abort-midway') P.clear = function () { const r = origClear.call(this); if (this.name === 'payments') this.transaction.abort(); return r; };
            try { await BackupTools.replaceAllStores(b, {}); return 'RESOLVED'; }
            catch (e) { return 'REJECTED: ' + e.message; }
            finally { P.put = origPut; P.clear = origClear; }
        }, kind, backupObj);
    }
    const boom = clone(good); boom.quotes.push({ id: 'q-BOOM', clientId: 'c1', invoice: 'BOOM' }); boom.meta.counts.quotes = boom.quotes.length;
    await test('put() throws while writing (after several stores were already cleared) → rejected, DB identical', async () => {
        await seed(ds); const before = await snapshot();
        const r = await injected('put-throws', boom);
        assert.ok(/^REJECTED/.test(r), r); assert.strictEqual(await snapshot(), before, 'partial replacement happened');
    });
    await test('transaction aborted midway (external abort while restoring) → rejected, DB identical', async () => {
        await seed(ds); const before = await snapshot();
        const r = await injected('abort-midway', good);
        assert.ok(/^REJECTED/.test(r), r); assert.strictEqual(await snapshot(), before, 'partial replacement happened');
    });
    await test('UI: transaction failure → "Restore FAILED … existing data was NOT changed", DB identical, no reload', async () => {
        await seed(ds); const before = await snapshot();
        const fp = writeTmp('boom.json', boom);
        await ev(() => { window.__op = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (v && v.id === 'q-BOOM') throw new Error('injected put failure'); return window.__op.call(this, v, k); }; });
        dialogs.length = 0; const s = await importFile(fp, false);
        await ev(() => { IDBObjectStore.prototype.put = window.__op; });
        assert.strictEqual(s.kind, 'error'); assert.ok(/Restore FAILED/.test(s.text) && /NOT changed/.test(s.text), s.text);
        assert.strictEqual(await snapshot(), before);
    });
    await test('restore is really ATOMIC: a backup that passes validation but fails on write leaves EVERY store intact', async () => {
        await seed(ds); const before = JSON.parse(await snapshot());
        await injected('put-throws', boom); const after = JSON.parse(await snapshot());
        ALL_STORES.forEach(s => assert.deepStrictEqual(after[s], before[s], 'store changed: ' + s));
    });

    // =================================================================== 1A + 1B. successful restore + credentials
    console.log('\n1A/1B. Successful restore, business data restored, local credentials preserved');
    await test('valid restore replaces business data, keeps LOCAL keys/PIN, drops junk, reloads', async () => {
        await seed(ds); await exportJson(); const file = fs.readdirSync(DL).filter(f => /Backup/.test(f)).map(f => path.join(DL, f))[0];
        const backupText = fs.readFileSync(file, 'utf8'); const fp = writeTmp('valid.json', backupText);
        // mutate the device AFTER exporting: junk client, delete c1, different local credentials, changed agency name
        await ev(async () => {
            await window.appDB.put('clients', { id: 'junk', name: 'JUNK CLIENT' }); await window.appDB.delete('clients', 'c1');
            const s = await window.appDB.get('settings', 'appSettings');
            Object.assign(s, { aiApiKeyGemini: 'NEW-LOCAL-GEMINI', aiApiKeyOpenAI: 'NEW-LOCAL-OPENAI', pin: '7777', pinEnabled: true, agencyName: 'Changed After Backup' });
            await window.appDB.put('settings', s);
        });
        dialogs.length = 0; await importFile(fp, true);
        const snap = await snapObj();
        ['clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes'].forEach(s => assert.deepStrictEqual(snap[s], JSON.parse(backupText)[s], 'store not restored: ' + s));
        assert.ok(!snap.clients.some(c => c.id === 'junk'), 'junk client survived'); assert.ok(snap.clients.some(c => c.id === 'c1'), 'c1 not restored');
        const s = snap.settings[0];
        assert.strictEqual(s.agencyName, 'Backup Agency ગુજરાત ₹', 'business settings restored from file');
        assert.strictEqual(s.aiApiKeyGemini, 'NEW-LOCAL-GEMINI'); assert.strictEqual(s.aiApiKeyOpenAI, 'NEW-LOCAL-OPENAI');
        assert.strictEqual(s.pin, '7777'); assert.strictEqual(s.pinEnabled, true); assert.strictEqual(s.migrated_v1, true);
        assert.ok(dialogs.some(d => d.type === 'confirm' && /Restore this backup/.test(d.message) && /Exported:/.test(d.message)));
        assert.ok(!dialogs.some(d => /contains saved API keys/.test(d.message)), 'credential prompt must not appear for a secrets-free backup');
        assert.ok(dialogs.some(d => d.type === 'alert' && /Restore complete/.test(d.message)));
    });
    await test('after restore the app works: settings loaded, PIN NOT locked out (pinEnabled preserved), pages render', async () => {
        const st = await ev(() => ({ agency: window.AppState.settings.agencyName, lock: getComputedStyle(document.getElementById('lockScreen')).display }));
        assert.strictEqual(st.agency, 'Backup Agency ગુજરાત ₹');
        // local pinEnabled=true + pin=7777 was preserved → lock is legitimately shown; unlock it to prove PIN still works
        assert.strictEqual(st.lock, 'grid');
        for (const k of ['7', '7', '7', '7']) await ev(k => document.querySelector('[data-pin="' + k + '"]').click(), k);
        await sleep(500); assert.strictEqual(await ev(() => getComputedStyle(document.getElementById('lockScreen')).display), 'none');
    });
    await test('restored data persists after ANOTHER reload', async () => {
        const before = await snapshot(); await load();
        // pin still enabled → unlock again if needed
        if (await ev(() => getComputedStyle(document.getElementById('lockScreen')).display) === 'grid') { for (const k of ['7', '7', '7', '7']) await ev(k => document.querySelector('[data-pin="' + k + '"]').click(), k); await sleep(500); }
        assert.strictEqual(await snapshot(), before);
    });
    await test('LEGACY flat backup (no meta, WITH secrets): valid; user says "keep device keys" → local keys kept', async () => {
        await seed(ds); const legacy = clone(ds); delete legacy.activity;
        legacy.settings[0].aiApiKeyGemini = 'OLD-FILE-KEY'; legacy.settings[0].pin = '1111'; legacy.settings[0].pinEnabled = false;
        await ev(async () => { const s = await window.appDB.get('settings', 'appSettings'); s.aiApiKeyGemini = 'DEVICE-KEY'; s.pin = '5555'; s.pinEnabled = false; await window.appDB.put('settings', s); });
        const fp = writeTmp('legacy.json', legacy); dialogs.length = 0;
        dialogHandler = (m) => ({ accept: !/contains saved API keys/.test(m) });   // accept restore, DECLINE credential restore
        await importFile(fp, true); dialogHandler = () => ({ accept: true });
        const s = (await snapObj()).settings[0];
        assert.ok(dialogs.some(d => /contains saved API keys/.test(d.message)), 'credential prompt expected');
        assert.strictEqual(s.aiApiKeyGemini, 'DEVICE-KEY'); assert.strictEqual(s.pin, '5555'); assert.strictEqual(s.agencyName, 'Backup Agency ગુજરાત ₹');
    });
    await test('LEGACY backup: user explicitly chooses "restore keys from file" → file keys/PIN restored', async () => {
        await seed(ds); const legacy = clone(ds); delete legacy.activity;
        legacy.settings[0].aiApiKeyGemini = 'OLD-FILE-KEY'; legacy.settings[0].pin = '1111'; legacy.settings[0].pinEnabled = false;
        await ev(async () => { const s = await window.appDB.get('settings', 'appSettings'); s.aiApiKeyGemini = 'DEVICE-KEY'; s.pin = '5555'; await window.appDB.put('settings', s); });
        const fp = writeTmp('legacy2.json', legacy); dialogHandler = () => ({ accept: true });
        await importFile(fp, true);
        const s = (await snapObj()).settings[0]; assert.strictEqual(s.aiApiKeyGemini, 'OLD-FILE-KEY'); assert.strictEqual(s.pin, '1111');
    });
    await test('restore into a device that has NO local settings/credentials → safe empty credentials', async () => {
        await seed(ds); const fp = writeTmp('valid2.json', await validBackupObject(ds));
        await ev(async () => { await window.appDB.clear('settings'); });
        await importFile(fp, true); const s = (await snapObj()).settings[0];
        assert.strictEqual(s.aiApiKeyGemini, ''); assert.strictEqual(s.pin, ''); assert.strictEqual(s.pinEnabled, false); assert.strictEqual(s.agencyName, 'Backup Agency ગુજરાત ₹');
    });
    await test('empty-settings backup keeps the device settings (nothing is lost)', async () => {
        await seed(ds); const b = await validBackupObject(ds); b.settings = []; b.meta.counts.settings = 0;
        await importFile(writeTmp('nosettings.json', b), true); const s = (await snapObj()).settings[0];
        assert.strictEqual(s.aiApiKeyGemini, LOCAL_SECRETS.aiApiKeyGemini); assert.strictEqual(s.agencyName, 'Backup Agency ગુજરાત ₹');
    });
    await test('a 3,000-record backup restores atomically in a reasonable time', async () => {
        await seed(ds); const big = await validBackupObject(ds);
        big.clients = Array.from({ length: 3000 }, (_, i) => ({ id: 'bulk' + i, name: 'Client ' + i })); big.meta.counts.clients = 3000;
        const t0 = Date.now(); await importFile(writeTmp('big.json', big), true); const dt = Date.now() - t0;
        assert.strictEqual((await snapObj()).clients.length, 3000); assert.ok(dt < 15000, 'took ' + dt + 'ms');
    });

    // =================================================================== 1C. CSV
    console.log('\n1C. CSV export (real downloads)');
    await seed(ds);
    const stores6 = ['clients', 'quotes', 'invoices', 'expenses', 'projects', 'payments'];
    for (const st of stores6) {
        await test('CSV ' + st + ': downloads, UTF-8 BOM, .csv name, round-trips every value', async () => {
            cleanDl(); await gotoData(); await ev(s => document.querySelector('[data-csv="' + s + '"]').click(), st);
            const f = await waitFile(new RegExp('^Automation_' + st + '_\\d{4}-\\d{2}-\\d{2}\\.csv$')); assert.ok(f, 'no CSV file for ' + st);
            const buf = fs.readFileSync(f); assert.deepStrictEqual([...buf.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'no UTF-8 BOM');
            const rows = parseCsv(buf.toString('utf8')); const H = rows[0]; const recs = (await snapObj())[st];
            assert.strictEqual(rows.length - 1, recs.length, 'row count');
            const union = []; recs.forEach(r => Object.keys(r).forEach(k => { if (!union.includes(k)) union.push(k); }));
            assert.deepStrictEqual(H, union, 'headers must be the union of ALL records');
            recs.forEach((rec, i) => H.forEach((h, c) => {
                const v = rec[h]; const exp = v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
                assert.strictEqual(rows[i + 1][c], exp, st + ' row ' + i + ' col ' + h);
            }));
            const s = await waitStatusSettled(); assert.ok(/record\(s\)/.test(s.text) && !/was saved/.test(s.text), s.text);
        });
    }
    await test('CSV clients: comma, quote, \\n, \\r, Gujarati, ₹, null, nested array/object all preserved', async () => {
        cleanDl(); await gotoData(); await ev(() => document.querySelector('[data-csv="clients"]').click());
        const f = await waitFile(/^Automation_clients_/); const text = fs.readFileSync(f, 'utf8'); const rows = parseCsv(text); const H = rows[0];
        const byId = {}; rows.slice(1).forEach(r => { byId[r[H.indexOf('id')]] = r; });
        assert.strictEqual(byId.c1[H.indexOf('name')], 'Acme, "Inc"'); assert.strictEqual(byId.c1[H.indexOf('company')], 'Line1\nLine2'); assert.strictEqual(byId.c1[H.indexOf('notes')], '');
        assert.strictEqual(byId.c2[H.indexOf('name')], 'બીટા ગુજરાતી ₹ 1,500'); assert.strictEqual(byId.c2[H.indexOf('extraField')], 'only here');
        assert.strictEqual(byId.c3[H.indexOf('name')], 'CR\rHere'); assert.deepStrictEqual(JSON.parse(byId.c3[H.indexOf('tags')]), ['x', 'y,z']); assert.deepStrictEqual(JSON.parse(byId.c3[H.indexOf('meta')]), { k: 'v', n: 1 });
        assert.ok(H.includes('extraField') && H.includes('notes') && H.includes('tags'), 'columns missing from the first record must exist');
    });
    await test('CSV quotes: nested deliverables/expenses arrays are exported (old code dropped them)', async () => {
        cleanDl(); await gotoData(); await ev(() => document.querySelector('[data-csv="quotes"]').click());
        const f = await waitFile(/^Automation_quotes_/); const rows = parseCsv(fs.readFileSync(f, 'utf8')); const H = rows[0];
        assert.ok(H.includes('deliverables') && H.includes('expenses'), 'nested columns dropped');
        const q1 = rows.find(r => r[H.indexOf('id')] === 'q1'); assert.deepStrictEqual(JSON.parse(q1[H.indexOf('deliverables')]), ['WhatsApp Setup', 'Ads']);
    });
    await test('empty store → entity-specific message, NO file, other data untouched', async () => {
        await ev(async () => { await window.appDB.clear('payments'); }); cleanDl(); const before = await snapshot();
        await gotoData(); await ev(() => document.querySelector('[data-csv="payments"]').click()); const s = await waitStatusSettled();
        assert.ok(/No Payments records to export/.test(s.text) && /other data is not affected/.test(s.text), s.text); assert.strictEqual(s.kind, 'info');
        assert.strictEqual(fs.readdirSync(DL).length, 0); assert.strictEqual(await snapshot(), before);
    });
    await test('CSV failure (database read throws) → clear error, no file', async () => {
        cleanDl(); await gotoData();
        await ev(() => { window.__g = window.appDB.getAll; window.appDB.getAll = async () => { throw new Error('injected getAll failure'); }; });
        await ev(() => document.querySelector('[data-csv="clients"]').click()); const s = await waitStatusSettled();
        await ev(() => { window.appDB.getAll = window.__g; });
        assert.strictEqual(s.kind, 'error'); assert.ok(/Clients export FAILED/.test(s.text) && /No file was created/.test(s.text), s.text); assert.strictEqual(fs.readdirSync(DL).length, 0);
    });

    // =================================================================== 1D. MIGRATION (real IndexedDB + localStorage)
    console.log('\n1D. Migration (real IndexedDB)');
    const KEY = 'automation_pricing_app_v1';
    const legacy = () => ({
        settings: { agencyName: 'Old Agency', taxRate: 12, currency: '$', darkMode: true, deliverables: ['X', 'Y'] },
        quotes: [
            { id: 'lq1', clientName: 'Acme', invoice: 'INV-1', date: '2024-01-01', setupFee: 100 },
            { id: 'lq2', clientName: 'acme ', invoice: 'INV-2', date: '2024-01-02', setupFee: 200 },
            { id: 'lq3', clientName: 'Beta', invoice: 'INV-3', date: '2024-01-03', setupFee: 300 }
        ]
    });
    async function emptyDb() { await ev(async (stores) => { for (const s of stores) await window.appDB.clear(s); localStorage.clear(); }, ALL_STORES); }
    const migState = () => ev(async () => ({ clients: (await appDB.getAll('clients')).map(c => c.name), quotes: (await appDB.getAll('quotes')).map(q => q.id).sort(), settings: await appDB.get('settings', 'appSettings') }));
    await test('fresh migration: quotes + one client per name + settings merged + flag set', async () => {
        await emptyDb(); await ev((k, l) => localStorage.setItem(k, JSON.stringify(l)), KEY, legacy());
        const r = await ev(() => runMigrationIfNeeded()); const s = await migState();
        assert.strictEqual(r.status, 'migrated'); assert.deepStrictEqual(s.quotes, ['lq1', 'lq2', 'lq3']); assert.strictEqual(s.clients.length, 2);
        assert.strictEqual(s.settings.migrated_v1, true); assert.strictEqual(s.settings.taxRate, 12); assert.strictEqual(s.settings.themeMode, 'dark');
        assert.ok(await ev(k => localStorage.getItem(k) !== null, KEY), 'localStorage must not be deleted');
    });
    await test('migration failure halfway: flag NOT written; retry finishes; no duplicates', async () => {
        await emptyDb(); await ev((k, l) => localStorage.setItem(k, JSON.stringify(l)), KEY, legacy());
        await ev(() => { window.__put = appDB.put; appDB.put = async function (s, d) { if (s === 'quotes' && d.id === 'lq2') throw new Error('simulated failure'); return window.__put.call(appDB, s, d); }; });
        const r1 = await ev(() => runMigrationIfNeeded()); const mid = await migState();
        await ev(() => { appDB.put = window.__put; });
        assert.strictEqual(r1.status, 'failed'); assert.strictEqual(mid.settings, undefined, 'flag/settings must not exist after a failed run'); assert.deepStrictEqual(mid.quotes, ['lq1']);
        const r2 = await ev(() => runMigrationIfNeeded()); const fin = await migState();
        assert.strictEqual(r2.status, 'migrated'); assert.deepStrictEqual(fin.quotes, ['lq1', 'lq2', 'lq3']);
        assert.deepStrictEqual(fin.clients.map(n => n.trim().toLowerCase()).sort(), ['acme', 'beta'], 'duplicate clients created on retry');
        assert.strictEqual(fin.settings.migrated_v1, true);
    });
    await test('running migration again after success changes nothing', async () => {
        const before = await snapshot(); const r = await ev(() => runMigrationIfNeeded()); assert.strictEqual(r.reason, 'already-migrated'); assert.strictEqual(await snapshot(), before);
    });
    await test('flag lost → rerun creates no duplicates and does not overwrite user edits', async () => {
        await ev(async () => { const q = await appDB.get('quotes', 'lq3'); q.notes = 'user edit'; await appDB.put('quotes', q); const s = await appDB.get('settings', 'appSettings'); delete s.migrated_v1; await appDB.put('settings', s); });
        const r = await ev(() => runMigrationIfNeeded()); const s = await migState();
        assert.strictEqual(r.clientsCreated, 0); assert.strictEqual(r.quotesCreated, 0); assert.strictEqual(s.clients.length, 2); assert.strictEqual(s.quotes.length, 3);
        assert.strictEqual((await ev(() => appDB.get('quotes', 'lq3'))).notes, 'user edit');
    });
    await test('existing settings preserved (AI keys, themeMode, phone, address) while legacy fills gaps', async () => {
        await emptyDb(); await ev((k, l) => localStorage.setItem(k, JSON.stringify(l)), KEY, legacy());
        const existing = { id: 'appSettings', agencyName: 'New Agency', phone: '+91 1', address: 'Surat', aiApiKeyGemini: 'KEEP-G', aiApiKeyOpenAI: 'KEEP-O', themeMode: 'light', pin: '9999', pinEnabled: true };
        await ev(s => appDB.put('settings', s), existing); await ev(() => runMigrationIfNeeded()); const s = (await migState()).settings;
        Object.keys(existing).forEach(k => assert.deepStrictEqual(s[k], existing[k], k)); assert.strictEqual(s.migrated_v1, true); assert.strictEqual(s.currency, '$'); assert.strictEqual(s.taxRate, 12);
    });
    await test('AUTOMATIC migration at app start (page reload with legacy localStorage): app boots, data present, settings usable', async () => {
        await emptyDb(); await ev((k, l) => localStorage.setItem(k, JSON.stringify(l)), KEY, legacy());
        pageErrors.length = 0; await load(); await sleep(300);
        const r = await ev(() => ({ res: window.lastMigrationResult, agency: AppState.settings.agencyName, theme: document.documentElement.dataset.theme, quotes: null }));
        const s = await migState();
        assert.strictEqual(r.res.status, 'migrated'); assert.strictEqual(r.agency, 'Old Agency'); assert.strictEqual(r.theme, 'dark'); assert.deepStrictEqual(s.quotes, ['lq1', 'lq2', 'lq3']);
        await ev(() => window.appRouter.navigate('quotes')); await sleep(300);
        assert.strictEqual(await ev(() => document.querySelectorAll('#quoteList .list-item').length), 3);
    });
    await test('invalid legacy JSON in localStorage: app still boots, nothing written', async () => {
        await emptyDb(); await ev(k => localStorage.setItem(k, '{ broken'), KEY); await load();
        assert.strictEqual((await ev(() => window.lastMigrationResult)).status, 'failed'); assert.strictEqual((await migState()).quotes.length, 0);
    });

    // =================================================================== REGRESSION
    console.log('\nRegression: previously verified behaviour must be unchanged');
    await emptyDb(); await seed(ds); await load();
    await test('all 14 routes render without exceptions', async () => {
        pageErrors.length = 0; const routes = await ev(() => Object.keys(window.appRouter.routes)); assert.strictEqual(routes.length, 14);
        for (const r of routes) { const ok = await ev(async r => { try { await window.appRouter.navigate(r); return document.getElementById('page-' + r).classList.contains('active'); } catch (e) { return String(e); } }, r); assert.strictEqual(ok, true, r + ': ' + ok); }
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('Reports show real IndexedDB numbers (revenue 1500, expenses 500, net 1000, 2 active clients)', async () => {
        await ev(() => window.appRouter.navigate('reports')); await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent), { timeout: 5000 });
        const t = await ev(() => ({ rev: repRev.textContent, exp: repExp.textContent, net: repNet.textContent, clients: repClients.textContent, quotes: repQuotes.textContent }));
        const num = (s) => Number(s.replace(/[^0-9.]/g, ''));
        assert.strictEqual(num(t.rev), 1500); assert.strictEqual(num(t.exp), 500); assert.strictEqual(num(t.net), 1000); assert.strictEqual(t.clients.trim(), '2'); assert.strictEqual(t.quotes.trim(), '2');
    });
    await test('Data page: 📅 filter button still opens the global filter drawer', async () => {
        await gotoData(); await ev(() => document.querySelector('#page-data .global-filter-btn').click());
        assert.strictEqual(await ev(() => document.getElementById('filterMenuDrawer').classList.contains('active')), true);
        await ev(() => document.querySelector('#page-data .global-filter-btn').click());
    });
    await test('Settings: save persists across reload (agency, tax, theme via top-bar toggle)', async () => {
        await ev(() => window.appRouter.navigate('settings')); await page.waitForSelector('#set-agencyName');
        await ev(() => { document.getElementById('set-agencyName').value = 'Regression Agency'; document.getElementById('saveProfileBtn').click(); });
        await ev(() => { document.getElementById('set-taxRate').value = '12'; document.getElementById('savePricingBtn').click(); }); await sleep(400);
        await ev(() => document.getElementById('themeBtn').click()); await sleep(300);
        await load();
        const s = await ev(() => ({ a: AppState.settings.agencyName, t: AppState.settings.taxRate, m: AppState.settings.themeMode, dom: document.documentElement.dataset.theme }));
        assert.strictEqual(s.a, 'Regression Agency'); assert.strictEqual(Number(s.t), 12); assert.ok(['dark', 'light'].includes(s.m)); assert.strictEqual(s.dom, s.m);
    });
    await test('Gemini connector untouched: 429 → quota message, success → Connected, request body minimal', async () => {
        await ev(() => window.appRouter.navigate('settings')); await page.waitForSelector('#testAiBtn');
        await page.select('#set-aiProvider', 'gemini'); await page.$eval('#set-aiApiKeyGemini', el => { el.value = 'AIzaSy-TEST'; });
        const run = async (fnSrc) => { await ev(src => { window.__req = null; window.fetch = async (u, o) => { window.__req = { u, b: o && o.body }; return eval('(' + src + ')')(); }; }, fnSrc); await ev(() => document.getElementById('testAiBtn').click()); await sleep(300); return ev(() => document.getElementById('aiTestResult').textContent); };
        const r429 = await run("() => new Response(JSON.stringify({error:{code:429,message:'quota',status:'RESOURCE_EXHAUSTED'}}),{status:429})");
        assert.ok(/quota/i.test(r429), r429);
        const ok = await run("() => new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Connection successful.'}]}}]}),{status:200})");
        assert.ok(/Connected/i.test(ok), ok);
        const body = JSON.parse(await ev(() => window.__req.b)); assert.strictEqual(body.contents[0].parts[0].text, 'Reply with exactly: Connection successful.');
    });
    await test('no uncaught page errors during the whole run', async () => { assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n')); });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 1 browser tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failures.length) console.log('FAILED: ' + failures.join(' | '));
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
