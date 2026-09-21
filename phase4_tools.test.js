// Phase 4 unit tests (Node, no dependencies): pure decision logic used by Settings / Reports / CSV export.
//   SettingsTools : theme values + PIN preference rules      ReportTools : Reports empty-state notices
//   BackupTools   : CSV date-filter helpers (added in Phase 4)
// Run:  node tests/phase4_tools.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = process.env.REPORTS_SETTINGS_FILE || path.join(__dirname, '../js/views/reports_settings.js');
const sandbox = { window: { appRouter: { addRoute() {} } }, console, Blob, Date, JSON, Set, Map, Object, Array, Number, String, RegExp, Error, isFinite, isNaN, Promise };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const ST = sandbox.window.SettingsTools, RT = sandbox.window.ReportTools, BT = sandbox.window.BackupTools;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
const appJsPinLock = (s) => !!(s.pinEnabled && /^\d{4}$/.test(s.pin));   // the exact condition used by app.js at start-up

console.log('\nSettingsTools.normalizeThemeMode');
test('valid modes pass through; anything else becomes "system"', () => {
    ['system', 'light', 'dark'].forEach(m => assert.strictEqual(ST.normalizeThemeMode(m), m));
    [undefined, null, '', 'DARK', 'blue', 1, true, {}, []].forEach(v => assert.strictEqual(ST.normalizeThemeMode(v), 'system', String(v)));
});
test('THEME_MODES lists exactly System / Light / Dark', () => { assert.deepStrictEqual(Array.from(ST.THEME_MODES), ['system', 'light', 'dark']); });

console.log('\nSettingsTools.isValidPin / isPinLockEffective');
test('isValidPin accepts exactly four digits (string) only', () => {
    ['0000', '1234', '9876'].forEach(p => assert.strictEqual(ST.isValidPin(p), true, p));
    ['', '123', '12345', 'abcd', '12a4', ' 1234', '1234 ', '12 34', '١٢٣٤', undefined, null, 1234, {}].forEach(p => assert.strictEqual(ST.isValidPin(p), false, String(p)));
});
test('isPinLockEffective is IDENTICAL to the condition app.js uses to lock the app (all combinations)', () => {
    [true, false, undefined, null].forEach(en => ['1234', '', '12', 'abcd', undefined].forEach(pin => {
        const s = { pinEnabled: en, pin }; assert.strictEqual(ST.isPinLockEffective(s), appJsPinLock(s), JSON.stringify(s));
    }));
    assert.strictEqual(ST.isPinLockEffective(undefined), false); assert.strictEqual(ST.isPinLockEffective(null), false);
});

console.log('\nSettingsTools.resolvePinPreference — decision table');
const R = (want, entered, stored) => ST.resolvePinPreference({ wantEnabled: want, enteredPin: entered, storedPin: stored });
test('turn ON, no PIN entered, none stored → BLOCKED with a clear message (the original saved "enabled" and never locked)', () => {
    const r = R(true, '', ''); assert.strictEqual(r.ok, false); assert.ok(/4-digit PIN/.test(r.message), r.message);
    assert.strictEqual(R(true, undefined, undefined).ok, false); assert.strictEqual(R(true, '   ', '').ok, false);
});
test('turn ON with a valid entered PIN → ok, PIN changed', () => {
    const r = R(true, '2468', ''); assert.deepStrictEqual({ ok: r.ok, enabled: r.enabled, pin: r.pin, pinChanged: r.pinChanged }, { ok: true, enabled: true, pin: '2468', pinChanged: true });
});
test('turn ON leaving the field blank while a valid PIN is already stored → ok, PIN kept', () => {
    const r = R(true, '', '1357'); assert.deepStrictEqual({ ok: r.ok, enabled: r.enabled, pin: r.pin, pinChanged: r.pinChanged }, { ok: true, enabled: true, pin: '1357', pinChanged: false });
});
test('turn ON, blank field, stored PIN is invalid (broken legacy state) → BLOCKED', () => {
    ['12', 'abcd', '', undefined].forEach(st => assert.strictEqual(R(true, '', st).ok, false, String(st)));
});
test('entered PIN that is not exactly 4 digits → BLOCKED with the "exactly 4 digits" message, whether turning ON or OFF', () => {
    ['1', '12', '123', '12345', 'abcd', '12a4', '12 4'].forEach(p => [true, false].forEach(w => {
        const r = R(w, p, '1234'); assert.strictEqual(r.ok, false, w + ' ' + p); assert.ok(/exactly 4 digits/.test(r.message), r.message);
    }));
});
test('surrounding whitespace around a valid PIN is trimmed', () => {
    const r = R(true, ' 4321 ', ''); assert.strictEqual(r.ok, true); assert.strictEqual(r.pin, '4321');
});
test('turn OFF keeps the stored PIN (unchanged behaviour) and reports lock OFF', () => {
    const r = R(false, '', '1234'); assert.deepStrictEqual({ ok: r.ok, enabled: r.enabled, pin: r.pin, pinChanged: r.pinChanged }, { ok: true, enabled: false, pin: '1234', pinChanged: false });
    assert.ok(/OFF/.test(r.summary));
});
test('turn OFF while entering a new valid PIN → PIN saved but lock stays OFF (message says so)', () => {
    const r = R(false, '9999', '1234'); assert.strictEqual(r.ok, true); assert.strictEqual(r.enabled, false); assert.strictEqual(r.pin, '9999'); assert.ok(/OFF/.test(r.summary) && /saved/i.test(r.summary), r.summary);
});
test('turn OFF is always allowed, even with no stored PIN and a blank field', () => {
    const r = R(false, '', ''); assert.strictEqual(r.ok, true); assert.strictEqual(r.enabled, false); assert.strictEqual(r.pin, '');
});
test('summaries tell the truth about the lock', () => {
    assert.ok(/ON/.test(R(true, '2468', '').summary) && /next time/.test(R(true, '2468', '').summary));
    assert.ok(/OFF/.test(R(false, '', '').summary));
});
test('EXHAUSTIVE INVARIANTS over 2 × 14 × 9 inputs: never "ok" with the lock ON and an unusable PIN; blocked results carry no state', () => {
    const entered = ['', '  ', '1', '12', '123', '1234', '12345', 'abcd', '12a4', ' 4321 ', undefined, null, '0000', '١٢٣٤'];
    const stored = ['', '1234', '12', 'abcd', undefined, null, '0000', '99999', ' 1234'];
    let n = 0;
    [true, false].forEach(w => entered.forEach(e => stored.forEach(s => {
        n++; const r = R(w, e, s);
        if (r.ok) {
            assert.strictEqual(r.enabled, w);
            if (r.enabled) { assert.ok(ST.isValidPin(r.pin), `ON with unusable pin: ${JSON.stringify([w, e, s])} → ${JSON.stringify(r)}`); assert.strictEqual(appJsPinLock({ pinEnabled: r.enabled, pin: r.pin }), true); }
            assert.strictEqual(typeof r.pin, 'string');
        } else { assert.ok(typeof r.message === 'string' && r.message.length > 5); assert.ok(!('enabled' in r) && !('pin' in r), 'a blocked result must not carry state to apply'); }
    })));
    assert.strictEqual(n, 2 * 14 * 9);
});
test('the function is pure (does not modify its input)', () => {
    const input = Object.freeze({ wantEnabled: true, enteredPin: '2468', storedPin: '' }); assert.doesNotThrow(() => ST.resolvePinPreference(input));
});

console.log('\nReportTools.reportsNotice');
const zero = { payments: 0, expenses: 0, clients: 0, projects: 0, quotes: 0 };
test('nothing stored at all → "No business data recorded yet" (info)', () => {
    const n = RT.reportsNotice({ allCounts: zero, shownCounts: zero, filterActive: false }); assert.strictEqual(n.kind, 'info'); assert.ok(/No business data recorded yet/.test(n.message), n.message);
});
test('nothing stored + filter active → still the "no data yet" message (the filter is not to blame)', () => {
    const n = RT.reportsNotice({ allCounts: zero, shownCounts: zero, filterActive: true }); assert.ok(/No business data recorded yet/.test(n.message));
});
test('data exists, filter active, nothing in range → "No records in the selected date range" and how to fix it', () => {
    const n = RT.reportsNotice({ allCounts: { payments: 3, expenses: 0, clients: 2, projects: 0, quotes: 0 }, shownCounts: zero, filterActive: true });
    assert.strictEqual(n.kind, 'info'); assert.ok(/No records in the selected date range/.test(n.message) && /Clear the date filter/.test(n.message), n.message);
});
test('data exists and something is shown → no notice (zeros are real numbers)', () => {
    assert.strictEqual(RT.reportsNotice({ allCounts: { payments: 0, expenses: 0, clients: 1, projects: 0, quotes: 0 }, shownCounts: { payments: 0, expenses: 0, clients: 1, projects: 0, quotes: 0 }, filterActive: false }), null);
    assert.strictEqual(RT.reportsNotice({ allCounts: { payments: 5, expenses: 1, clients: 0, projects: 0, quotes: 0 }, shownCounts: { payments: 1, expenses: 0, clients: 0, projects: 0, quotes: 0 }, filterActive: true }), null);
});
test('data exists, filter NOT active, nothing shown is impossible → no notice', () => {
    assert.strictEqual(RT.reportsNotice({ allCounts: { payments: 2, expenses: 0, clients: 0, projects: 0, quotes: 0 }, shownCounts: zero, filterActive: false }), null);
});

console.log('\nBackupTools — CSV date-filter helpers');
test('CSV_DATE_FIELDS covers exactly the six CSV stores with the SAME fields the pages filter on', () => {
    assert.deepStrictEqual(Object.keys(BT.CSV_DATE_FIELDS).sort(), Object.keys(BT.CSV_LABELS).sort());
    assert.deepStrictEqual(Object.assign({}, BT.CSV_DATE_FIELDS), { clients: 'dateAdded', quotes: 'date', invoices: 'date', expenses: 'date', projects: 'startDate', payments: 'date' });
});
test('describeDateFilter: range / open-ended / with times / none', () => {
    assert.strictEqual(BT.describeDateFilter({ fromDate: '2026-09-01', toDate: '2026-09-30' }), '2026-09-01 → 2026-09-30');
    assert.strictEqual(BT.describeDateFilter({ fromDate: '2026-09-01', toDate: '' }), 'from 2026-09-01');
    assert.strictEqual(BT.describeDateFilter({ fromDate: '', toDate: '2026-09-30' }), 'until 2026-09-30');
    assert.strictEqual(BT.describeDateFilter({ fromDate: '2026-09-01', fromTime: '09:00', toDate: '2026-09-30', toTime: '17:30' }), '2026-09-01 09:00 → 2026-09-30 17:30');
    assert.strictEqual(BT.describeDateFilter({ fromDate: '', toDate: '' }), ''); assert.strictEqual(BT.describeDateFilter(undefined), '');
});
test('emptyFilteredCsvMessage is different from the empty-store message and says how many exist outside the range', () => {
    const m = BT.emptyFilteredCsvMessage('payments', 7);
    assert.ok(/No Payments records match the selected date range/.test(m) && /7 records exist outside it/.test(m) && /Clear the date filter/.test(m), m);
    assert.ok(/1 record exists outside it/.test(BT.emptyFilteredCsvMessage('clients', 1)), BT.emptyFilteredCsvMessage('clients', 1));
    assert.notStrictEqual(m, BT.emptyCsvMessage('payments'));
});

console.log('\n' + '='.repeat(60));
console.log('Phase 4 unit tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
