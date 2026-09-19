// Phase 1 regression tests (Node, no dependencies): backup validation, secrets-free backup,
// credential-preserving settings merge, and CSV generation.
// Run:  node tests/phase1_backup_csv.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = process.env.REPORTS_SETTINGS_FILE || path.join(__dirname, '../js/views/reports_settings.js');
const sandbox = {
    window: { appRouter: { addRoute() {} } },
    console, Blob, Date, JSON, Set, Map, Object, Array, Number, String, RegExp, Error, isFinite, isNaN, Promise
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const BT = sandbox.window.BackupTools;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- fixtures -------------------------------------------------------------
function validAll() {
    return {
        settings: [{ id: 'appSettings', agencyName: 'ગુજરાત Agency ₹', taxRate: 18, deliverables: ['A'], themeMode: 'dark',
                     aiApiKeyGemini: 'AIzaSy-SECRET-GEMINI', aiApiKeyOpenAI: 'sk-SECRET-OPENAI', pin: '1234', pinEnabled: true, migrated_v1: true }],
        clients: [{ id: 'c1', name: 'Acme, "Inc"' }, { id: 'c2', name: 'બીટા' }],
        services: [{ id: 's1', name: 'Setup' }],
        quotes: [{ id: 'q1', invoice: 'QT-1', deliverables: ['x'], expenses: [{ name: 'e', amount: 1 }] }],
        projects: [{ id: 'p1', name: 'P1' }],
        tasks: [{ id: 't1', title: 'T' }],
        invoices: [{ id: 'i1', number: 'INV-1' }],
        payments: [{ id: 'pay1', amount: 5 }],
        expenses: [{ id: 'e1', amount: 2 }],
        team: [{ id: 'm1', name: 'Member' }],
        notes: [{ id: 'n1', title: 'N' }]
    };
}
const validBackup = () => BT.buildBackupObject(validAll(), new Date('2026-09-19T10:00:00Z'));

// RFC 4180 parser used to round-trip generated CSV
function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
            if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// ============================================================================
console.log('\nvalidateBackup — valid inputs');
test('valid new-format backup passes', () => {
    const r = BT.validateBackup(validBackup());
    assert.strictEqual(r.ok, true, r.errors.join('; '));
    assert.strictEqual(r.counts.clients, 2);
});
test('valid LEGACY flat backup (no meta) passes', () => {
    const r = BT.validateBackup(validAll());
    assert.strictEqual(r.ok, true, r.errors.join('; '));
});
test('empty stores are valid (fresh install backup)', () => {
    const all = validAll(); BT.STORES.forEach(s => { if (s !== 'settings') all[s] = []; });
    assert.strictEqual(BT.validateBackup(all).ok, true);
});
test('numeric ids are accepted', () => {
    const all = validAll(); all.quotes[0].id = 1712345678;
    assert.strictEqual(BT.validateBackup(all).ok, true);
});
test('unknown extra section is only a warning', () => {
    const all = validAll(); all.activity = [];
    const r = BT.validateBackup(all);
    assert.strictEqual(r.ok, true); assert.ok(r.warnings.length === 1);
});

console.log('\nparseBackupText — invalid JSON / wrong shape');
test('invalid JSON is rejected with a clear message', () => {
    const r = BT.parseBackupText('{ this is not json');
    assert.strictEqual(r.ok, false); assert.ok(/not valid JSON/.test(r.errors[0])); assert.strictEqual(r.backup, null);
});
test('empty file / whitespace rejected', () => {
    assert.strictEqual(BT.parseBackupText('').ok, false);
    assert.strictEqual(BT.parseBackupText('   \n ').ok, false);
});
test('JSON null / array / number / string rejected', () => {
    ['null', '[]', '42', '"hello"', 'true'].forEach(t => assert.strictEqual(BT.parseBackupText(t).ok, false, t));
});
test('UTF-8 BOM in front of valid JSON is tolerated', () => {
    const r = BT.parseBackupText('\uFEFF' + JSON.stringify(validBackup()));
    assert.strictEqual(r.ok, true, r.errors.join('; '));
});
test('valid text returns the parsed backup', () => {
    const r = BT.parseBackupText(JSON.stringify(validBackup()));
    assert.strictEqual(r.ok, true); assert.strictEqual(r.backup.clients.length, 2);
});

console.log('\nvalidateBackup — missing / wrong-type stores');
BT.STORES.forEach(store => {
    test('missing store "' + store + '" is rejected (' + store + ')', () => {
        const b = validBackup(); delete b[store]; delete b.meta;
        const r = BT.validateBackup(b);
        assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => e.indexOf('"' + store + '" is missing') !== -1), r.errors.join('; '));
    });
});
[['object', {}], ['string', 'abc'], ['null', null], ['number', 5], ['boolean', true]].forEach(([label, val]) => {
    test('store is ' + label + ', not an array → rejected', () => {
        const b = validBackup(); delete b.meta; b.clients = val;
        const r = BT.validateBackup(b);
        assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => /"clients" is not a list/.test(e)));
    });
});

console.log('\nvalidateBackup — bad records');
[['missing id', {}], ['empty id', { id: '' }], ['blank id', { id: '   ' }], ['null id', { id: null }],
 ['object id', { id: {} }], ['boolean id', { id: true }], ['NaN id', { id: NaN }]].forEach(([label, patch]) => {
    test('record with ' + label + ' → rejected', () => {
        const b = validAll(); b.quotes[0] = Object.assign({ invoice: 'x' }, patch);
        if (label === 'missing id') delete b.quotes[0].id;
        const r = BT.validateBackup(b);
        assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => /quotes\[0\] has no valid "id"/.test(e)), r.errors.join('; '));
    });
});
[['null', null], ['string', 'x'], ['number', 3], ['array', [1, 2]], ['boolean', false]].forEach(([label, rec]) => {
    test('malformed record (' + label + ') → rejected', () => {
        const b = validAll(); b.payments.push(rec);
        const r = BT.validateBackup(b);
        assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => /payments\[1\] is not a valid record/.test(e)));
    });
});
test('duplicate id inside a store → rejected (would silently lose a record)', () => {
    const b = validAll(); b.clients.push({ id: 'c1', name: 'Dup' });
    const r = BT.validateBackup(b); assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => /repeats the id/.test(e)));
});
test('id 1 and "1" are different keys (no false duplicate)', () => {
    const b = validAll(); b.clients = [{ id: 1, name: 'a' }, { id: '1', name: 'b' }];
    assert.strictEqual(BT.validateBackup(b).ok, true);
});
test('client without a text name → rejected (would crash the Clients page)', () => {
    const b = validAll(); b.clients = [{ id: 'c9' }];
    assert.strictEqual(BT.validateBackup(b).ok, false);
});
test('quote with non-array deliverables/expenses → rejected', () => {
    const b = validAll(); b.quotes[0].expenses = 'oops';
    assert.strictEqual(BT.validateBackup(b).ok, false);
});
test('settings with a wrong id / two records / bad deliverables → rejected', () => {
    let b = validAll(); b.settings[0].id = 'other'; assert.strictEqual(BT.validateBackup(b).ok, false);
    b = validAll(); b.settings.push({ id: 'appSettings' }); assert.strictEqual(BT.validateBackup(b).ok, false);
    b = validAll(); b.settings[0].deliverables = 'x'; assert.strictEqual(BT.validateBackup(b).ok, false);
});
test('settings store may be empty (default settings are regenerated)', () => {
    const b = validAll(); b.settings = []; assert.strictEqual(BT.validateBackup(b).ok, true);
});

console.log('\nvalidateBackup — meta');
test('newer schema version → rejected', () => {
    const b = validBackup(); b.meta.schemaVersion = 99; assert.strictEqual(BT.validateBackup(b).ok, false);
});
test('invalid schema version / wrong app / malformed meta → rejected', () => {
    let b = validBackup(); b.meta.schemaVersion = 'two'; assert.strictEqual(BT.validateBackup(b).ok, false);
    b = validBackup(); b.meta.app = 'Other App'; assert.strictEqual(BT.validateBackup(b).ok, false);
    b = validBackup(); b.meta = 'x'; assert.strictEqual(BT.validateBackup(b).ok, false);
});
test('declared count ≠ actual count (truncated file) → rejected', () => {
    const b = validBackup(); b.clients.pop();
    const r = BT.validateBackup(b); assert.strictEqual(r.ok, false); assert.ok(r.errors.some(e => /incomplete or edited/.test(e)));
});
test('summarizeErrors caps long lists', () => {
    const s = BT.summarizeErrors(Array.from({ length: 30 }, (_, i) => 'e' + i), 5);
    assert.ok(/and 25 more/.test(s));
});

console.log('\nbuildBackupObject — metadata + secrets');
test('meta contains app, schema, exportedAt, counts, excluded list', () => {
    const b = validBackup();
    assert.strictEqual(b.meta.app, 'Automation Manager');
    assert.strictEqual(b.meta.schemaVersion, BT.SCHEMA_VERSION);
    assert.strictEqual(b.meta.exportedAt, '2026-09-19T10:00:00.000Z');
    assert.strictEqual(b.meta.counts.clients, 2);
    assert.deepStrictEqual(Array.from(b.meta.secretsExcluded).sort(), ['aiApiKeyGemini', 'aiApiKeyOpenAI', 'pin', 'pinEnabled']);
});
test('backup contains all 11 stores', () => {
    const b = validBackup(); BT.STORES.forEach(s => assert.ok(Array.isArray(b[s]), s));
});
test('SECRETS ARE ABSENT from the serialized JSON', () => {
    const json = JSON.stringify(validBackup());
    // secret VALUES and secret KEYS (with the colon) must not appear; meta.secretsExcluded only lists the field NAMES
    ['AIzaSy-SECRET-GEMINI', 'sk-SECRET-OPENAI', '1234', '"pin":', '"pinEnabled":', '"aiApiKeyGemini":', '"aiApiKeyOpenAI":'].forEach(s =>
        assert.ok(json.indexOf(s) === -1, 'found ' + s));
    const settings = JSON.parse(json).settings[0];
    ['aiApiKeyGemini', 'aiApiKeyOpenAI', 'pin', 'pinEnabled'].forEach(k => assert.ok(!(k in settings), 'settings still has ' + k));
});
test('non-secret settings survive (themeMode, deliverables, migrated_v1, Gujarati)', () => {
    const s = validBackup().settings[0];
    assert.strictEqual(s.themeMode, 'dark'); assert.strictEqual(s.migrated_v1, true); assert.ok(s.agencyName.indexOf('ગુજરાત') === 0);
});
test('source records are not mutated by the export', () => {
    const all = validAll(); BT.buildBackupObject(all);
    assert.strictEqual(all.settings[0].pin, '1234');
});
test('missing store during export → throws (never an incomplete backup)', () => {
    const all = validAll(); delete all.notes;
    assert.throws(() => BT.buildBackupObject(all), /incomplete/);
});
test('an exported backup always validates (round trip through JSON)', () => {
    const r = BT.parseBackupText(JSON.stringify(validBackup(), null, 2)); assert.strictEqual(r.ok, true, r.errors.join('; '));
});

console.log('\nmergeSettingsForRestore — local credentials are preserved');
const local = { id: 'appSettings', aiApiKeyGemini: 'LOCAL-G', aiApiKeyOpenAI: 'LOCAL-O', pin: '9999', pinEnabled: true, migrated_v1: true };
test('backup without secrets → local secrets kept', () => {
    const m = BT.mergeSettingsForRestore({ id: 'appSettings', agencyName: 'From Backup', themeMode: 'light' }, local);
    assert.strictEqual(m.aiApiKeyGemini, 'LOCAL-G'); assert.strictEqual(m.aiApiKeyOpenAI, 'LOCAL-O');
    assert.strictEqual(m.pin, '9999'); assert.strictEqual(m.pinEnabled, true);
    assert.strictEqual(m.agencyName, 'From Backup'); assert.strictEqual(m.themeMode, 'light');
});
test('legacy backup WITH secrets → still keeps local secrets by default', () => {
    const m = BT.mergeSettingsForRestore({ id: 'appSettings', pin: '1111', pinEnabled: false, aiApiKeyGemini: 'OLD' }, local);
    assert.strictEqual(m.pin, '9999'); assert.strictEqual(m.pinEnabled, true); assert.strictEqual(m.aiApiKeyGemini, 'LOCAL-G');
});
test('explicit choice restoreCredentials:true → file values used', () => {
    const m = BT.mergeSettingsForRestore({ id: 'appSettings', pin: '1111', pinEnabled: false, aiApiKeyGemini: 'FROM-FILE' }, local, { restoreCredentials: true });
    assert.strictEqual(m.pin, '1111'); assert.strictEqual(m.aiApiKeyGemini, 'FROM-FILE');
    assert.strictEqual(m.aiApiKeyOpenAI, 'LOCAL-O'); // not in file → local kept
});
test('no local settings → safe empty defaults, never undefined', () => {
    const m = BT.mergeSettingsForRestore({ id: 'appSettings' }, undefined);
    assert.strictEqual(m.pin, ''); assert.strictEqual(m.pinEnabled, false); assert.strictEqual(m.aiApiKeyGemini, '');
});
test('migrated_v1 marker is never lost', () => {
    assert.strictEqual(BT.mergeSettingsForRestore({ id: 'appSettings' }, local).migrated_v1, true);
});
test('settingsHaveCredentials', () => {
    assert.strictEqual(BT.settingsHaveCredentials({ pin: '1234' }), true);
    assert.strictEqual(BT.settingsHaveCredentials({ aiApiKeyGemini: 'k' }), true);
    assert.strictEqual(BT.settingsHaveCredentials({ pinEnabled: true }), true);
    assert.strictEqual(BT.settingsHaveCredentials({ pin: '', aiApiKeyGemini: '', pinEnabled: false }), false);
    assert.strictEqual(BT.settingsHaveCredentials(undefined), false);
});

console.log('\nbuildCsv');
const csvFixture = [
    { id: 'a1', name: 'Plain', note: null, amount: 100 },
    { id: 'a2', name: 'Comma, Inc', extra: 'only in 2nd record', note: 'say "hi"' },
    { id: 'a3', name: 'Line1\nLine2', note: 'CR\rHere', tags: ['x', 'y,z'], obj: { k: 'v', n: 1 } },
    { id: 'a4', name: 'ગુજરાતી ₹ 1,500', amount: 0, flag: false }
];
test('headers are the UNION of all records (first-seen order)', () => {
    const c = BT.buildCsv(csvFixture);
    assert.deepStrictEqual(Array.from(c.headers), ['id', 'name', 'note', 'amount', 'extra', 'tags', 'obj', 'flag']);
});
test('text starts with UTF-8 BOM and uses CRLF', () => {
    const c = BT.buildCsv(csvFixture);
    assert.strictEqual(c.text.charCodeAt(0), 0xFEFF); assert.ok(c.text.indexOf('\r\n') > 0);
    const bytes = Buffer.from(new Blob([c.text]).size ? c.text : '', 'utf8');
    assert.deepStrictEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
});
test('round trip: every value survives comma / quote / \\n / \\r / Gujarati / ₹', () => {
    const c = BT.buildCsv(csvFixture);
    const rows = parseCsv(c.text);
    assert.strictEqual(rows.length, 1 + csvFixture.length);
    const H = rows[0];
    csvFixture.forEach((rec, i) => {
        H.forEach((h, col) => {
            const expected = rec[h] === undefined || rec[h] === null ? '' : (typeof rec[h] === 'object' ? JSON.stringify(rec[h]) : String(rec[h]));
            assert.strictEqual(rows[i + 1][col], expected, 'row ' + (i + 1) + ' col ' + h);
        });
    });
});
test('null / undefined → empty cell; false and 0 are kept', () => {
    const rows = parseCsv(BT.buildCsv(csvFixture).text); const H = rows[0];
    assert.strictEqual(rows[1][H.indexOf('note')], ''); assert.strictEqual(rows[4][H.indexOf('flag')], 'false'); assert.strictEqual(rows[4][H.indexOf('amount')], '0');
});
test('nested array / object become JSON', () => {
    const rows = parseCsv(BT.buildCsv(csvFixture).text); const H = rows[0];
    assert.deepStrictEqual(JSON.parse(rows[3][H.indexOf('tags')]), ['x', 'y,z']);
    assert.deepStrictEqual(JSON.parse(rows[3][H.indexOf('obj')]), { k: 'v', n: 1 });
});
test('field containing a lone \\r is quoted', () => {
    assert.strictEqual(BT.csvEscape('a\rb'), '"a\rb"');
});
test('fields are only quoted when needed; quotes are doubled', () => {
    assert.strictEqual(BT.csvEscape('plain'), 'plain'); assert.strictEqual(BT.csvEscape('a,b'), '"a,b"'); assert.strictEqual(BT.csvEscape('say "x"'), '"say ""x"""');
});
test('a column missing from the FIRST record is not dropped (old bug)', () => {
    const c = BT.buildCsv([{ id: 1 }, { id: 2, later: 'kept' }]);
    assert.ok(c.headers.indexOf('later') !== -1); assert.strictEqual(parseCsv(c.text)[2][1], 'kept');
});
test('a field that is null in the FIRST record is not dropped (old bug)', () => {
    const c = BT.buildCsv([{ id: 1, notes: null }, { id: 2, notes: 'n' }]);
    assert.ok(c.headers.indexOf('notes') !== -1);
});
test('a header that itself needs escaping is escaped', () => {
    const rows = parseCsv(BT.buildCsv([{ 'a,b': 1 }]).text); assert.strictEqual(rows[0][0], 'a,b');
});
test('entity-specific empty message', () => {
    assert.ok(/No Clients records/.test(BT.emptyCsvMessage('clients')));
    assert.ok(/No Payments records/.test(BT.emptyCsvMessage('payments')));
    assert.ok(/other data is not affected/.test(BT.emptyCsvMessage('quotes')));
});

console.log('\n' + '='.repeat(60));
console.log('Phase 1 backup/CSV tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
