// Phase 3 browser tests (real Chromium + real IndexedDB + real UI): date-filter behaviour on the
// Invoices / Payments / Expenses / Tasks pages, lookup lists that must NOT be date-filtered,
// and the default invoice due date (local calendar date).
//   PUPPETEER_CORE=/path/to/puppeteer-core CHROME_PATH=/path/to/chrome [APP_ROOT=/path/to/app] node tests/phase3_browser.test.js
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

// ---- independent calendar oracle (no JS Date arithmetic) for the due-date tests ----
const pad = (n, w) => String(n).padStart(w || 2, '0');
const fmt = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function addDays({ y, m, d }, n) { while (n > 0) { d++; if (d > dim(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } } n--; } return { y, m, d }; }
function localYmd(ms, tz) { const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return { y: +p.year, m: +p.month, d: +p.day }; }

let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 7).join('\n      ')); }
}

const DATA = () => ({
    clients: [{ id: 'c1', name: 'Acme', status: 'Active', dateAdded: '2026-08-01T00:00:00.000Z' }, { id: 'c2', name: 'Beta', status: 'Active', dateAdded: '2026-09-01T00:00:00.000Z' }],
    invoices: [
        { id: 'iOld', number: 'INV-OLD', date: '2026-08-10', clientId: 'c1', amount: 1000, dueDate: '2026-09-10' },
        { id: 'iNew', number: 'INV-NEW', date: '2026-09-05', clientId: 'c2', amount: 500, dueDate: '2026-10-05' }
    ],
    payments: [
        { id: 'pOld', invoiceId: 'iOld', amount: 100, date: '2026-08-15', method: 'UPI' },
        { id: 'pMixed', invoiceId: 'iOld', amount: 200, date: '2026-09-10', method: 'UPI' },   // in range, but its INVOICE is out of range
        { id: 'pNew', invoiceId: 'iNew', amount: 300, date: '2026-09-06', method: 'Cash' }
    ],
    expenses: [
        { id: 'eOld', name: 'Old Expense', amount: 50, date: '2026-08-05', category: 'Office' },
        { id: 'eNew1', name: 'New Expense One', amount: 60, date: '2026-09-07', category: 'Software' },
        { id: 'eNew2', name: 'New Expense Two', amount: 70, date: '2026-09-08', category: 'Software' }
    ],
    projects: [
        { id: 'prOld', name: 'Old Project', clientId: 'c1', status: 'In Progress', startDate: '2026-08-01', deadline: '2026-10-01' },
        { id: 'prNew', name: 'New Project', clientId: 'c2', status: 'Planning', startDate: '2026-09-01', deadline: '2026-10-15' }
    ],
    tasks: [
        { id: 'tOld', title: 'Task of old project', projectId: 'prOld', clientId: 'c1', dueDate: '2026-09-20', status: 'Pending', notes: 'keep me' },
        { id: 'tNew', title: 'Task of new project', projectId: 'prNew', clientId: 'c2', dueDate: '2026-09-21', status: 'Pending', notes: '' },
        { id: 'tGen', title: 'General task', projectId: '', clientId: '', dueDate: '2026-09-22', status: 'Pending', notes: '' }
    ]
});

(async () => {
    const { srv, port } = await startServer();
    const BASE = 'http://localhost:' + port + '/index.html';
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    if (page.setBypassServiceWorker) await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', r => { if (/cdn\.jsdelivr\.net/.test(r.url())) r.abort(); else r.continue(); });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
        const R = Date; window.__NOW = null;           // controllable clock
        class D extends R {
            constructor(...a) { if (a.length === 0 && window.__NOW !== null) super(window.__NOW); else super(...a); }
            static now() { return window.__NOW !== null ? window.__NOW : R.now(); }
        }
        window.Date = D;
    });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept());            // native confirm() => OK
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const setNow = (iso) => ev(ms => { window.__NOW = ms; }, iso === null ? null : Date.parse(iso));
    const ALL = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
    async function load() { await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.AppState && window.AppState.settings && window.appRouter, { timeout: 10000 }); }
    async function resetData() {
        await load();
        await ev(async (stores) => { for (const s of stores) await window.appDB.clear(s); localStorage.clear(); }, ALL);
        await load();                                    // first run: default settings are created
        const d = DATA();
        await ev(async (d) => { for (const [store, rows] of Object.entries(d)) for (const r of rows) await window.appDB.put(store, r); }, d);
    }
    const snapshot = () => ev(() => initDB().then(db => new Promise(res => {
        const names = [...db.objectStoreNames].sort(); const tx = db.transaction(names, 'readonly'); const o = {};
        names.forEach(n => { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { o[n] = r.result; }; }); tx.oncomplete = () => res(JSON.stringify(o));
    })));
    const dbGet = (store, id) => ev((s, i) => window.appDB.get(s, i), store, id);
    const dbAll = (store) => ev(s => window.appDB.getAll(s), store);
    const go = async (route) => { await ev(r => window.appRouter.navigate(r), route); };
    const listText = (sel) => ev(s => [...document.querySelectorAll(s + ' .list-item')].map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
    const listEmpty = (sel) => ev(s => { const e = document.querySelector(s + ' .empty'); return e ? e.innerText.trim() : null; }, sel);
    async function applyFilter(from, to) {
        await ev(() => document.querySelector('.global-filter-btn').click());
        await ev((f, t) => { document.getElementById('filterFromDate').value = f; document.getElementById('filterToDate').value = t; document.getElementById('filterPreset').value = 'custom'; }, from, to);
        await ev(() => document.getElementById('applyFilterBtn').click()); await sleep(250);
    }
    async function clearFilter() { await ev(() => document.querySelector('.global-filter-btn').click()); await ev(() => document.getElementById('clearFilterBtn').click()); await sleep(250); }
    const SEP = ['2026-09-01', '2026-09-30'];

    console.log('\nApp under test: ' + ROOT);

    // ===================================================================== A. baseline (no filter): must be identical before/after the fix
    console.log('\nA. Baseline without a filter (behaviour that must NOT change)');
    await resetData();
    await test('Payments page: all 3 payments, invoice numbers resolved', async () => {
        await go('payments'); const rows = await listText('#payList');
        assert.strictEqual(rows.length, 3); assert.ok(rows.some(r => r.includes('₹200.00') && r.includes('Inv: INV-OLD')), rows.join(' | ')); assert.ok(rows.some(r => r.includes('₹300.00') && r.includes('Inv: INV-NEW')));
    });
    await test('Invoices page: statuses computed from ALL payments (Partial / Partial)', async () => {
        await go('invoices'); const rows = await listText('#invList'); assert.strictEqual(rows.length, 2);
        assert.ok(rows.find(r => r.includes('INV-OLD')).includes('Partial') && rows.find(r => r.includes('INV-NEW')).includes('Partial'), rows.join(' | '));
    });
    await test('Tasks page: project names resolved (Old Project / New Project / General)', async () => {
        await go('tasks'); const rows = await listText('#globalTaskList'); assert.strictEqual(rows.length, 3);
        assert.ok(rows.some(r => r.includes('Old Project')) && rows.some(r => r.includes('New Project')) && rows.some(r => r.includes('General')), rows.join(' | '));
    });
    await test('merely VIEWING Invoices / Payments / Expenses / Tasks never changes the database', async () => {
        const before = await snapshot(); for (const r of ['invoices', 'payments', 'expenses', 'tasks']) await go(r); assert.strictEqual(await snapshot(), before);
    });

    await test('NO filter: deleting a payment / an invoice / an expense updates each list as before (nothing extra hidden or shown)', async () => {
        await resetData();
        await go('payments'); await ev(() => document.querySelector('[data-del-pay="pNew"]').click()); await sleep(300);
        assert.strictEqual((await listText('#payList')).length, 2);
        await go('invoices'); await ev(() => document.querySelector('[data-del-inv="iNew"]').click()); await sleep(300);
        let rows = await listText('#invList'); assert.strictEqual(rows.length, 1); assert.ok(rows[0].includes('INV-OLD'));
        await go('expenses'); await ev(() => document.querySelector('[data-del-exp="eNew1"]').click());
        await page.waitForSelector('.confirm-overlay .btn.danger'); await ev(() => document.querySelector('.confirm-overlay .btn.danger').click()); await sleep(300);
        assert.strictEqual((await listText('#expList')).length, 2);
        assert.deepStrictEqual((await dbAll('payments')).map(p => p.id).sort(), ['pMixed', 'pOld']);
        assert.deepStrictEqual((await dbAll('invoices')).map(i => i.id), ['iOld']);
    });
    await test('deleting a task on the Tasks page (no filter) still works and keeps the others', async () => {
        await resetData(); await go('tasks'); await ev(() => document.querySelector('[data-global-del="tGen"]').click()); await sleep(300);
        assert.strictEqual((await listText('#globalTaskList')).length, 2); assert.deepStrictEqual((await dbAll('tasks')).map(t => t.id).sort(), ['tNew', 'tOld']);
    });

    // ===================================================================== B. Payments under an active filter
    console.log('\nB. Payments page with the date filter ACTIVE (Sep 2026)');
    await resetData(); await go('payments'); await applyFilter(...SEP);
    await test('date filtering is preserved: only the 2 payments dated in September are listed', async () => {
        const rows = await listText('#payList'); assert.strictEqual(rows.length, 2, rows.join(' | ')); assert.ok(!rows.some(r => r.includes('₹100.00')), 'August payment leaked in');
    });
    await test('a payment whose INVOICE is outside the filter still shows its invoice number (not "Unknown")', async () => {
        const rows = await listText('#payList'); const mixed = rows.find(r => r.includes('₹200.00')); assert.ok(mixed, rows.join(' | '));
        assert.ok(mixed.includes('Inv: INV-OLD') && !mixed.includes('Unknown'), mixed);
    });
    await test('"Record Payment": the invoice list contains ALL invoices, not only the filtered ones', async () => {
        await ev(() => document.getElementById('newPayBtn').click()); await page.waitForSelector('#pf-invoice');
        const opts = await ev(() => [...document.querySelectorAll('#pf-invoice option')].map(o => o.textContent.trim()).filter(t => !t.startsWith('Select')));
        assert.strictEqual(opts.length, 2, JSON.stringify(opts)); assert.ok(opts.some(o => o.startsWith('INV-OLD')) && opts.some(o => o.startsWith('INV-NEW')), JSON.stringify(opts));
    });
    await test('a payment can be recorded against the out-of-range invoice while the filter is active', async () => {
        await ev(() => { document.getElementById('pf-invoice').value = 'iOld'; document.getElementById('pf-amount').value = '40'; document.getElementById('pf-date').value = '2026-09-12'; document.getElementById('payForm').requestSubmit(); });
        await sleep(400); const all = await dbAll('payments'); const np = all.find(p => p.amount === 40);
        assert.ok(np && np.invoiceId === 'iOld' && np.date === '2026-09-12', JSON.stringify(all));
        assert.strictEqual(all.length, 4);
    });
    await resetData(); await go('payments'); await applyFilter(...SEP);
    await test('deleting a payment keeps the date filter active (out-of-range payments must NOT reappear)', async () => {
        await ev(() => document.querySelector('[data-del-pay="pNew"]').click()); await sleep(300);
        const rows = await listText('#payList'); assert.strictEqual(rows.length, 1, 'list after delete: ' + rows.join(' | ')); assert.ok(rows[0].includes('₹200.00'), rows[0]);
        const ids = (await dbAll('payments')).map(p => p.id).sort(); assert.deepStrictEqual(ids, ['pMixed', 'pOld']);
    });
    await test('deleting under a filter that matches nothing left shows the empty message, not everything', async () => {
        await ev(() => document.querySelector('[data-del-pay="pMixed"]').click()); await sleep(300);
        assert.ok(/No payments recorded/.test(await listEmpty('#payList') || ''), 'pOld (August) must stay hidden');
        assert.deepStrictEqual((await dbAll('payments')).map(p => p.id), ['pOld']);
    });

    // ===================================================================== C. Invoices under an active filter
    console.log('\nC. Invoices page with the date filter ACTIVE (Sep 2026)');
    await resetData(); await go('invoices'); await applyFilter(...SEP);
    await test('date filtering is preserved: only INV-NEW (Sep 5) is listed', async () => {
        const rows = await listText('#invList'); assert.strictEqual(rows.length, 1, rows.join(' | ')); assert.ok(rows[0].includes('INV-NEW'));
    });
    await test('"+ Add Payment": the invoice list has ALL invoices and the clicked one is pre-selected', async () => {
        await ev(() => document.querySelector('[data-pay-inv="iNew"]').click()); await page.waitForSelector('#pf-invoice');
        const st = await ev(() => ({ opts: [...document.querySelectorAll('#pf-invoice option')].map(o => o.textContent.trim()).filter(t => !t.startsWith('Select')), sel: document.getElementById('pf-invoice').value }));
        assert.strictEqual(st.opts.length, 2, JSON.stringify(st)); assert.strictEqual(st.sel, 'iNew');
    });
    await resetData(); await go('invoices'); await applyFilter(...SEP);
    await test('deleting an invoice keeps the date filter (the August invoice must NOT reappear)', async () => {
        await ev(() => document.querySelector('[data-del-inv="iNew"]').click()); await sleep(300);
        assert.ok(/No invoices found/.test(await listEmpty('#invList') || ''), 'list after delete: ' + (await listText('#invList')).join(' | '));
        assert.deepStrictEqual((await dbAll('invoices')).map(i => i.id), ['iOld']);
        assert.strictEqual((await dbAll('payments')).length, 3, 'payments stay (orphaned by design)');
    });

    // ===================================================================== D. Expenses under an active filter
    console.log('\nD. Expenses page with the date filter ACTIVE (Sep 2026)');
    await resetData(); await go('expenses'); await applyFilter(...SEP);
    await test('date filtering is preserved: only the 2 September expenses are listed', async () => {
        const rows = await listText('#expList'); assert.strictEqual(rows.length, 2, rows.join(' | ')); assert.ok(!rows.some(r => r.includes('Old Expense')));
    });
    await test('deleting an expense keeps the date filter (the August expense must NOT reappear)', async () => {
        await ev(() => document.querySelector('[data-del-exp="eNew1"]').click());
        await page.waitForSelector('.confirm-overlay .btn.danger'); await ev(() => document.querySelector('.confirm-overlay .btn.danger').click()); await sleep(300);
        const rows = await listText('#expList'); assert.strictEqual(rows.length, 1, 'list after delete: ' + rows.join(' | ')); assert.ok(rows[0].includes('New Expense Two'));
        assert.deepStrictEqual((await dbAll('expenses')).map(e => e.id).sort(), ['eNew2', 'eOld']);
    });

    // ===================================================================== E. Tasks under an active filter
    console.log('\nE. Tasks page with the date filter ACTIVE (Sep 2026) — projects are only a lookup here');
    await resetData(); await go('tasks'); await applyFilter(...SEP);
    await test('a task of an out-of-range project still shows its project name (not "Unknown")', async () => {
        const rows = await listText('#globalTaskList'); const t = rows.find(r => r.includes('Task of old project')); assert.ok(t, rows.join(' | '));
        assert.ok(t.includes('Old Project') && !t.includes('Unknown'), t);
    });
    await test('the task list itself is unchanged by the filter (all 3 tasks; tasks are not date-filtered on this page)', async () => {
        assert.strictEqual((await listText('#globalTaskList')).length, 3);
    });
    await test('EDIT: the Project Link list contains all projects and keeps the task\'s project selected', async () => {
        await ev(() => document.querySelector('[data-global-edit="tOld"]').click()); await page.waitForSelector('#tf-project');
        const st = await ev(() => ({ opts: [...document.querySelectorAll('#tf-project option')].map(o => o.textContent.trim()), sel: document.getElementById('tf-project').value }));
        assert.ok(st.opts.includes('Old Project') && st.opts.includes('New Project'), JSON.stringify(st)); assert.strictEqual(st.sel, 'prOld');
    });
    await test('DATA SAFETY: saving an edited task under a filter does NOT unlink it from its project / client', async () => {
        await ev(() => { document.getElementById('tf-title').value = 'Renamed task'; document.getElementById('taskForm').requestSubmit(); }); await sleep(400);
        const t = await dbGet('tasks', 'tOld');
        assert.strictEqual(t.title, 'Renamed task'); assert.strictEqual(t.projectId, 'prOld', 'projectId was wiped: ' + JSON.stringify(t)); assert.strictEqual(t.clientId, 'c1', 'clientId was wiped: ' + JSON.stringify(t));
        assert.strictEqual(t.notes, 'keep me'); assert.strictEqual(t.dueDate, '2026-09-20');
    });
    await test('NEW task under a filter: every project can be chosen', async () => {
        await go('tasks'); await ev(() => document.getElementById('globalNewTaskBtn').click()); await page.waitForSelector('#tf-project');
        const opts = await ev(() => [...document.querySelectorAll('#tf-project option')].map(o => o.textContent.trim()));
        assert.ok(opts.includes('Old Project') && opts.includes('New Project'), JSON.stringify(opts));
        await ev(() => { document.getElementById('tf-title').value = 'Linked to old project'; document.getElementById('tf-project').value = 'prOld'; document.getElementById('taskForm').requestSubmit(); }); await sleep(400);
        const t = (await dbAll('tasks')).find(x => x.title === 'Linked to old project'); assert.ok(t && t.projectId === 'prOld' && t.clientId === 'c1', JSON.stringify(t));
    });
    await test('clearing the filter changes nothing about the lists', async () => {
        await go('tasks'); await clearFilter(); assert.ok((await listText('#globalTaskList')).length >= 3);
        await go('payments'); assert.strictEqual((await listText('#payList')).length, 3);
    });

    // ===================================================================== F. default invoice due date
    console.log('\nF. New-invoice default due date = LOCAL today + validity (never the UTC date)');
    await resetData(); await go('invoices');
    const dueCases = [
        ['Asia/Kolkata', '2026-09-18T20:30:00Z', '02:00 IST on Sep 19 (UTC is still Sep 18)', 30],
        ['America/New_York', '2026-09-20T03:30:00Z', '23:30 New York on Sep 19 (UTC is already Sep 20)', 30],
        ['Pacific/Kiritimati', '2026-09-18T11:00:00Z', '01:00 Kiritimati on Sep 19', 30],
        ['UTC', '2026-09-19T12:00:00Z', 'noon UTC on Sep 19 (control)', 30],
        ['America/New_York', '2026-10-16T02:00:00Z', '22:00 New York on Oct 15 — 30 days cross the DST change', 30],
        ['Asia/Kolkata', '2026-09-18T20:30:00Z', '02:00 IST with a 45-day validity', 45],
        ['Europe/Berlin', '2026-12-31T23:30:00Z', '00:30 Berlin on Jan 1 — 30 days cross the new year', 30]
    ];
    for (const [tz, iso, label, days] of dueCases) {
        await test(`${label} → due date ${days} local days later`, async () => {
            await page.emulateTimezone(tz); await ev(async (d) => { const s = await window.appDB.get('settings', 'appSettings'); s.defaultQuoteValidity = d; await window.appDB.put('settings', s); window.AppState.settings.defaultQuoteValidity = d; }, days);
            await setNow(iso); await go('invoices'); await page.waitForSelector('#newInvBtn'); await ev(() => document.getElementById('newInvBtn').click()); await page.waitForSelector('#if-due');
            const got = await ev(() => ({ due: document.getElementById('if-due').value, date: document.getElementById('if-date').value })); await setNow(null);
            const today = localYmd(Date.parse(iso), tz); assert.strictEqual(got.date, fmt(today), 'invoice date'); assert.strictEqual(got.due, fmt(addDays(today, days)), 'due date');
        });
    }
    await test('validity 0 → the due date stays empty (unchanged behaviour)', async () => {
        await page.emulateTimezone('Asia/Kolkata'); await ev(async () => { const s = await window.appDB.get('settings', 'appSettings'); s.defaultQuoteValidity = 0; await window.appDB.put('settings', s); window.AppState.settings.defaultQuoteValidity = 0; });
        await go('invoices'); await ev(() => document.getElementById('newInvBtn').click()); await page.waitForSelector('#if-due'); assert.strictEqual(await ev(() => document.getElementById('if-due').value), '');
    });
    await test('creating an invoice saves the chosen due date', async () => {
        await ev(() => { document.getElementById('if-client').value = 'c1'; document.getElementById('if-amount').value = '250'; document.getElementById('if-due').value = '2026-11-11'; document.getElementById('invForm').requestSubmit(); }); await sleep(400);
        const inv = (await dbAll('invoices')).find(i => i.amount === 250); assert.ok(inv && inv.dueDate === '2026-11-11' && inv.clientId === 'c1', JSON.stringify(inv));
    });

    // ===================================================================== G. regression
    console.log('\nG. Regression');
    await resetData();
    await test('all 14 routes render without exceptions', async () => {
        pageErrors.length = 0; const routes = await ev(() => Object.keys(window.appRouter.routes)); assert.strictEqual(routes.length, 14);
        for (const r of routes) { const ok = await ev(async r => { try { await window.appRouter.navigate(r); return document.getElementById('page-' + r).classList.contains('active'); } catch (e) { return String(e); } }, r); assert.strictEqual(ok, true, r + ': ' + ok); }
        assert.deepStrictEqual(pageErrors, []);
    });
    await test('the global filter still filters Reports (unchanged): Sep revenue 500 / expenses 130', async () => {
        await go('reports'); await applyFilter(...SEP);
        await page.waitForFunction(() => !/Loading/.test(document.getElementById('repRev').textContent));
        const t = await ev(() => ({ r: repRev.textContent, e: repExp.textContent })); const n = s => Number(s.replace(/[^0-9.]/g, ''));
        assert.strictEqual(n(t.r), 500); assert.strictEqual(n(t.e), 130);   // 200+300 payments, 60+70 expenses
    });
    await test('no uncaught page errors during the whole run', async () => { assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n')); });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 3 browser tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failures.length) console.log('FAILED: ' + failures.join(' | '));
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
