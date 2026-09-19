// Phase 1 regression tests (Node, no dependencies): localStorage -> IndexedDB migration
// uses an in-memory appDB mock with fault injection.
// Run:  node tests/phase1_migration.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = process.env.MIGRATION_FILE || path.join(__dirname, '../js/utils/migration.js');
const source = fs.readFileSync(file, 'utf8');
const KEY = 'automation_pricing_app_v1';
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeEnv(legacy, opts) {
    opts = opts || {};
    const stores = { settings: new Map(), clients: new Map(), quotes: new Map() };
    let idCounter = 0;
    const hooks = { failPut: null };            // (store, record, callNumber) => throw to inject a failure
    let puts = 0;
    const appDB = {
        async get(s, id) { const v = stores[s].get(id); return v === undefined ? undefined : clone(v); },
        async getAll(s) { return [...stores[s].values()].map(clone); },
        async put(s, d) {
            puts++;
            if (hooks.failPut) hooks.failPut(s, d, puts);
            stores[s].set(d.id, clone(d));
        }
    };
    const store = {};
    if (legacy !== undefined) store[KEY] = typeof legacy === 'string' ? legacy : JSON.stringify(legacy);
    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        removeItem: (k) => { delete store[k]; },
        _raw: store
    };
    const win = { appDB };
    const sb = { window: win, localStorage, console: { log() {}, error() {} }, generateId: () => 'gen' + (++idCounter), Date, Number, JSON, Array, Map, String, isFinite, Object };
    vm.createContext(sb);
    vm.runInContext(source, sb, { filename: file });
    if (opts.existingSettings) stores.settings.set('appSettings', clone(opts.existingSettings));
    if (opts.existingClients) opts.existingClients.forEach(c => stores.clients.set(c.id, clone(c)));
    if (opts.existingQuotes) opts.existingQuotes.forEach(q => stores.quotes.set(q.id, clone(q)));
    return { sb, stores, hooks, run: () => sb.runMigrationIfNeeded(), win, localStorage };
}
const dump = (e) => JSON.stringify({ s: [...e.stores.settings.entries()], c: [...e.stores.clients.entries()], q: [...e.stores.quotes.entries()] });

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

const legacy = () => ({
    settings: { agencyName: 'Old Agency', taxRate: 12, metaRate: 0.9, currency: '$', invoicePrefix: 'OLD', deliverables: ['X', 'Y'], darkMode: true, pinEnabled: true, pin: '4321' },
    quotes: [
        { id: 'q1', clientName: 'Acme', invoice: 'INV-1', date: '2024-01-01', setupFee: '100', retainer: 50, deliverables: ['A'], expenses: [{ name: 'e', amount: 5 }], status: 'Approved' },
        { id: 'q2', clientName: 'acme ', invoice: 'INV-2', date: '2024-01-02', setupFee: 200 },
        { id: 'q3', clientName: 'Beta', invoice: 'INV-3', date: '2024-01-03', setupFee: 300 },
        { id: 'q4', invoice: 'INV-4', date: '2024-01-04' }
    ]
});

(async () => {
    console.log('\n1. Fresh + successful migration');
    await test('migrates quotes, creates one client per distinct name (case/space-insensitive), sets flag', async () => {
        const e = makeEnv(legacy());
        const r = await e.run();
        assert.strictEqual(r.status, 'migrated');
        assert.strictEqual(e.stores.quotes.size, 4);
        assert.strictEqual(e.stores.clients.size, 2, 'Acme + Beta');
        assert.strictEqual(r.clientsCreated, 2); assert.strictEqual(r.quotesCreated, 4);
        assert.strictEqual(e.stores.settings.get('appSettings').migrated_v1, true);
        assert.strictEqual(e.stores.quotes.get('q1').clientId, e.stores.quotes.get('q2').clientId, 'same client');
        assert.strictEqual(e.stores.quotes.get('q4').clientId, null, 'quote without a client name');
        assert.strictEqual(e.stores.quotes.get('q1').setupFee, 100);
    });
    await test('legacy settings are carried over (tax, currency, deliverables, PIN)', async () => {
        const e = makeEnv(legacy()); await e.run();
        const s = e.stores.settings.get('appSettings');
        assert.strictEqual(s.agencyName, 'Old Agency'); assert.strictEqual(s.taxRate, 12); assert.strictEqual(s.currency, '$');
        assert.deepStrictEqual(s.deliverables, ['X', 'Y']); assert.strictEqual(s.pin, '4321'); assert.strictEqual(s.pinEnabled, true);
    });
    await test('taxRate 0 is preserved (old code turned 0 into 18)', async () => {
        const l = legacy(); l.settings.taxRate = 0; l.settings.metaRate = 0;
        const e = makeEnv(l); await e.run();
        const s = e.stores.settings.get('appSettings'); assert.strictEqual(s.taxRate, 0); assert.strictEqual(s.metaRate, 0);
    });
    await test('localStorage is NOT deleted', async () => {
        const e = makeEnv(legacy()); await e.run(); assert.ok(e.localStorage.getItem(KEY) !== null);
    });
    await test('no legacy data → nothing written, status reported', async () => {
        const e = makeEnv(undefined); const r = await e.run();
        assert.strictEqual(r.reason, 'no-legacy-data'); assert.strictEqual(e.stores.settings.size, 0);
    });

    console.log('\n2. Failure halfway → flag NOT set → retry completes (no duplicates)');
    await test('failure while writing the 2nd quote: flag absent, status failed', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s, d) => { if (s === 'quotes' && d.id === 'q2') throw new Error('simulated write failure'); };
        const r = await e.run();
        assert.strictEqual(r.status, 'failed'); assert.ok(/simulated/.test(r.error));
        assert.strictEqual(e.stores.settings.has('appSettings'), false, 'settings/flag must not be written yet');
        assert.ok(e.stores.quotes.has('q1') && !e.stores.quotes.has('q2'));
    });
    await test('retry after the failure completes everything with NO duplicate clients/quotes', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s, d) => { if (s === 'quotes' && d.id === 'q2') throw new Error('simulated'); };
        await e.run();
        e.hooks.failPut = null;
        const r = await e.run();
        assert.strictEqual(r.status, 'migrated');
        assert.strictEqual(e.stores.quotes.size, 4); assert.strictEqual(e.stores.clients.size, 2);
        const names = [...e.stores.clients.values()].map(c => c.name.trim().toLowerCase()).sort();
        assert.deepStrictEqual(names, ['acme', 'beta']);
        assert.strictEqual(e.stores.settings.get('appSettings').migrated_v1, true);
        assert.strictEqual(r.quotesSkippedExisting, 1, 'q1 was already written by the failed run');
    });
    await test('failure while writing a CLIENT: retry does not duplicate clients', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s, d) => { if (s === 'clients' && d.name === 'Beta') throw new Error('client write failed'); };
        assert.strictEqual((await e.run()).status, 'failed');
        e.hooks.failPut = null; await e.run();
        assert.strictEqual(e.stores.clients.size, 2);
    });
    await test('failure while writing SETTINGS (last step): flag absent; retry succeeds without duplicates', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s) => { if (s === 'settings') throw new Error('settings write failed'); };
        assert.strictEqual((await e.run()).status, 'failed');
        assert.strictEqual(e.stores.settings.has('appSettings'), false);
        e.hooks.failPut = null; assert.strictEqual((await e.run()).status, 'migrated');
        assert.strictEqual(e.stores.quotes.size, 4); assert.strictEqual(e.stores.clients.size, 2);
    });
    await test('repeated failures never set the flag, then a clean run succeeds', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s, d) => { if (s === 'quotes' && d.id === 'q3') throw new Error('x'); };
        await e.run(); await e.run(); await e.run();
        assert.strictEqual(e.stores.settings.has('appSettings'), false);
        e.hooks.failPut = null; await e.run();
        assert.strictEqual(e.stores.quotes.size, 4); assert.strictEqual(e.stores.clients.size, 2);
    });
    await test('edits made between a failed run and the retry are NOT overwritten', async () => {
        const e = makeEnv(legacy());
        e.hooks.failPut = (s, d) => { if (s === 'quotes' && d.id === 'q2') throw new Error('x'); };
        await e.run(); e.hooks.failPut = null;
        const q1 = e.stores.quotes.get('q1'); q1.notes = 'EDITED BY USER'; e.stores.quotes.set('q1', q1);
        await e.run();
        assert.strictEqual(e.stores.quotes.get('q1').notes, 'EDITED BY USER');
    });

    console.log('\n3. Idempotency');
    await test('running again after success changes nothing (byte-identical stores)', async () => {
        const e = makeEnv(legacy()); await e.run();
        const before = dump(e);
        const r = await e.run(); assert.strictEqual(r.reason, 'already-migrated');
        assert.strictEqual(dump(e), before);
    });
    await test('even if the flag is lost, re-running creates no duplicates and overwrites nothing', async () => {
        const e = makeEnv(legacy()); await e.run();
        const q3 = e.stores.quotes.get('q3'); q3.notes = 'user edit'; e.stores.quotes.set('q3', q3);
        const s = e.stores.settings.get('appSettings'); delete s.migrated_v1; e.stores.settings.set('appSettings', s);
        const r = await e.run();
        assert.strictEqual(e.stores.quotes.size, 4); assert.strictEqual(e.stores.clients.size, 2);
        assert.strictEqual(e.stores.quotes.get('q3').notes, 'user edit');
        assert.strictEqual(r.clientsCreated, 0); assert.strictEqual(r.quotesCreated, 0);
    });
    await test('quotes WITHOUT an id get a deterministic id (retry cannot duplicate them)', async () => {
        const l = { quotes: [{ clientName: 'NoId Co', invoice: 'A' }, { clientName: 'NoId Co', invoice: 'B' }] };
        const e = makeEnv(l);
        e.hooks.failPut = (s, d) => { if (s === 'quotes' && d.invoice === 'B') throw new Error('x'); };
        await e.run(); e.hooks.failPut = null; await e.run();
        assert.strictEqual(e.stores.quotes.size, 2); assert.strictEqual(e.stores.clients.size, 1);
        assert.ok(e.stores.quotes.has('legacy-quote-1') && e.stores.quotes.has('legacy-quote-2'));
    });
    await test('numeric legacy ids become string ids (usable from data-* attributes)', async () => {
        const e = makeEnv({ quotes: [{ id: 1712345678, clientName: 'N', invoice: 'A' }] }); await e.run();
        assert.ok(e.stores.quotes.has('1712345678'));
    });
    await test('existing client with the same name is reused, not duplicated', async () => {
        const e = makeEnv(legacy(), { existingClients: [{ id: 'existing-acme', name: 'ACME' }] });
        await e.run();
        assert.strictEqual(e.stores.quotes.get('q1').clientId, 'existing-acme');
        assert.strictEqual(e.stores.clients.size, 2, 'existing Acme + new Beta');
    });
    await test('already-flagged settings → migration is skipped entirely', async () => {
        const e = makeEnv(legacy(), { existingSettings: { id: 'appSettings', migrated_v1: true, agencyName: 'Mine' } });
        const before = dump(e); const r = await e.run();
        assert.strictEqual(r.reason, 'already-migrated'); assert.strictEqual(dump(e), before);
    });

    console.log('\n4. Existing settings are merged, never overwritten');
    const existing = { id: 'appSettings', agencyName: 'New Agency', phone: '+91 99999 00000', address: '12 Main Rd, Surat', email: 'a@b.co',
                       aiProvider: 'gemini', aiApiKeyGemini: 'AIza-KEEP-ME', aiApiKeyOpenAI: 'sk-KEEP-ME', themeMode: 'light', gstNumber: '24ABCDE1234F1Z5', taxRate: 5 };
    await test('AI keys, themeMode, phone, address and every other existing field are preserved', async () => {
        const e = makeEnv(legacy(), { existingSettings: existing }); await e.run();
        const s = e.stores.settings.get('appSettings');
        Object.keys(existing).forEach(k => assert.deepStrictEqual(s[k], existing[k], k + ' was changed'));
        assert.strictEqual(s.migrated_v1, true);
    });
    await test('legacy values only FILL fields the existing settings lack (currency, prefix, logo…)', async () => {
        const e = makeEnv(legacy(), { existingSettings: existing }); await e.run();
        const s = e.stores.settings.get('appSettings');
        assert.strictEqual(s.currency, '$'); assert.strictEqual(s.invoicePrefix, 'OLD'); assert.deepStrictEqual(s.deliverables, ['X', 'Y']);
    });
    await test('existing themeMode wins over legacy darkMode', async () => {
        const e = makeEnv(legacy(), { existingSettings: existing }); await e.run();
        assert.strictEqual(e.stores.settings.get('appSettings').themeMode, 'light');
    });
    await test('legacy darkMode:true → themeMode "dark" when no themeMode exists', async () => {
        const e = makeEnv(legacy()); await e.run(); const s = e.stores.settings.get('appSettings');
        assert.strictEqual(s.themeMode, 'dark'); assert.strictEqual(s.darkMode, true);
    });
    await test('legacy darkMode:false → themeMode "light"', async () => {
        const l = legacy(); l.settings.darkMode = false; const e = makeEnv(l); await e.run();
        assert.strictEqual(e.stores.settings.get('appSettings').themeMode, 'light');
    });
    await test('legacy darkMode absent → themeMode NOT invented (app default "system" applies)', async () => {
        const l = legacy(); delete l.settings.darkMode; const e = makeEnv(l); await e.run();
        assert.strictEqual('themeMode' in e.stores.settings.get('appSettings'), false);
    });
    await test('existing settings keep their values even when an existing field is explicitly undefined', async () => {
        const e = makeEnv(legacy(), { existingSettings: { id: 'appSettings', agencyName: undefined, phone: '1' } }); await e.run();
        const s = e.stores.settings.get('appSettings'); assert.strictEqual(s.agencyName, 'Old Agency'); assert.strictEqual(s.phone, '1');
    });

    console.log('\n5. Bad legacy data');
    await test('invalid JSON in localStorage → nothing written, flag not set, data untouched', async () => {
        const e = makeEnv('{ broken json'); const r = await e.run();
        assert.strictEqual(r.status, 'failed'); assert.strictEqual(r.reason, 'invalid-legacy-data');
        assert.strictEqual(e.stores.settings.size + e.stores.quotes.size + e.stores.clients.size, 0);
        assert.ok(e.localStorage.getItem(KEY) !== null);
    });
    await test('legacy JSON that is not an object (null / array) is rejected safely', async () => {
        for (const raw of ['null', '[]', '5']) { const e = makeEnv(raw); assert.strictEqual((await e.run()).status, 'failed', raw); }
    });
    await test('malformed quote entries (null / string) are skipped and counted, the rest migrates', async () => {
        const e = makeEnv({ quotes: [null, 'x', { id: 'ok', clientName: 'C', invoice: 'I' }, 7] });
        const r = await e.run();
        assert.strictEqual(r.status, 'migrated'); assert.strictEqual(r.invalidSkipped, 3); assert.strictEqual(e.stores.quotes.size, 1);
    });
    await test('non-string clientName and non-array deliverables/expenses do not crash the migration', async () => {
        const e = makeEnv({ quotes: [{ id: 'w', clientName: 12345, deliverables: 'oops', expenses: 'oops' }] });
        assert.strictEqual((await e.run()).status, 'migrated');
        const q = e.stores.quotes.get('w'); assert.deepStrictEqual(q.deliverables, []); assert.deepStrictEqual(q.expenses, []);
        assert.strictEqual([...e.stores.clients.values()][0].name, '12345');
    });
    await test('legacy data with no quotes array still migrates settings and sets the flag', async () => {
        const e = makeEnv({ settings: { agencyName: 'Only Settings' } }); assert.strictEqual((await e.run()).status, 'migrated');
        assert.strictEqual(e.stores.settings.get('appSettings').agencyName, 'Only Settings');
    });
    await test('result is exposed as window.lastMigrationResult for diagnostics', async () => {
        const e = makeEnv(legacy()); await e.run(); assert.strictEqual(e.win.lastMigrationResult.status, 'migrated');
    });

    console.log('\n' + '='.repeat(60));
    console.log('Phase 1 migration tests: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
