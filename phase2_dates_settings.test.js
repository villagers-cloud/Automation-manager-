// Phase 2 regression tests (Node, no dependencies):
//   * local date helpers (formatLocalDate, getTodayDate)
//   * filter presets (getDatePresetRange) verified against an independent calendar oracle
//   * settings defaults merge (getDefaultSettings, mergeSettingsWithDefaults, AppState.loadSettings)
// Run:  node tests/phase2_dates_settings.test.js        (runs itself in 14 timezones)
//       TZ=Asia/Kolkata P2_CHILD=1 node tests/phase2_dates_settings.test.js   (one timezone)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ZONES = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
    'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Sao_Paulo', 'Asia/Tokyo'];

// ---------------------------------------------------------------- driver: one child process per timezone
if (!process.env.P2_CHILD) {
    let bad = 0;
    for (const tz of ZONES) {
        const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, P2_CHILD: '1' }), encoding: 'utf8' });
        const last = (r.stdout.trim().split('\n').filter(l => /Phase 2 tests/.test(l)).pop()) || '(no summary)';
        console.log((r.status === 0 ? '✓ ' : '✗ ') + tz.padEnd(22) + last);
        if (r.status !== 0) { bad++; console.log(r.stdout.split('\n').filter(l => /✗|Error|assert/i.test(l)).slice(0, 12).join('\n')); }
    }
    console.log('\n' + '='.repeat(60) + '\nPhase 2 Node tests, all timezones: ' + (bad ? bad + ' timezone(s) FAILED' : 'ALL ' + ZONES.length + ' TIMEZONES PASSED'));
    process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- load helpers.js in a sandbox
const helpersFile = process.env.HELPERS_FILE || path.join(__dirname, '../js/utils/helpers.js');
const RealDate = Date;
const written = [];       // every appDB.put
let dbRecord;             // what appDB.get('settings') returns
const sandbox = {
    window: {
        matchMedia: () => ({ matches: false, addEventListener() {} }),
        showSaveFilePicker: null,
        appDB: {
            async get() { return dbRecord === undefined ? undefined : JSON.parse(JSON.stringify(dbRecord)); },
            async put(store, rec) { written.push({ store, rec: JSON.parse(JSON.stringify(rec)) }); dbRecord = JSON.parse(JSON.stringify(rec)); }
        }
    },
    document: { documentElement: { dataset: {} }, createElement: () => ({}), body: { appendChild() {}, removeChild() {} }, getElementById: () => null },
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    console, Date: RealDate, Math, String, Number, isNaN
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(helpersFile, 'utf8'), sandbox, { filename: helpersFile });
const H = sandbox;                       // function declarations become sandbox globals
const AppState = sandbox.window.AppState;

function freezeNow(ms) {
    const fixed = new RealDate(ms);
    sandbox.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) return new RealDate(ms); return new RealDate(...a); }
        static now() { return ms; }
    };
    return fixed;
}
const unfreeze = () => { sandbox.Date = RealDate; };

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 5).join('\n      ')); }
    finally { unfreeze(); }
}
async function atest(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message).split('\n').slice(0, 5).join('\n      ')); }
    finally { unfreeze(); written.length = 0; dbRecord = undefined; AppState.settings = null; }
}

// ---------------------------------------------------------------- independent oracle (no JS Date arithmetic at all)
const pad = (n, w) => String(n).padStart(w || 2, '0');
const fmt = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function addDays({ y, m, d }, n) {
    while (n > 0) { d++; if (d > dim(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } } n--; }
    while (n < 0) { d--; if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = dim(y, m); } n++; }
    return { y, m, d };
}
function daysFromCivil(y, m, d) {           // Howard Hinnant's algorithm: days since 1970-01-01
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}
const weekday = ({ y, m, d }) => (((daysFromCivil(y, m, d) + 4) % 7) + 7) % 7;   // 0 = Sunday (1970-01-01 was a Thursday)
const TZNAME = process.env.TZ || 'UTC';
const zoneFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZNAME, year: 'numeric', month: '2-digit', day: '2-digit' });
function localYmd(ms) {                     // the date on the wall calendar of TZNAME at this instant
    const p = {}; zoneFmt.formatToParts(new RealDate(ms)).forEach(x => { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day };
}
function expectedPreset(preset, t) {
    const dow = weekday(t);
    switch (preset) {
        case 'today': return { from: fmt(t), to: fmt(t) };
        case 'yesterday': return { from: fmt(addDays(t, -1)), to: fmt(addDays(t, -1)) };
        case 'this_week': return { from: fmt(addDays(t, -dow)), to: fmt(t) };
        case 'last_week': return { from: fmt(addDays(t, -(dow + 7))), to: fmt(addDays(t, -(dow + 1))) };
        case 'this_month': return { from: fmt({ y: t.y, m: t.m, d: 1 }), to: fmt(t) };
        case 'last_month': { const pm = t.m === 1 ? { y: t.y - 1, m: 12 } : { y: t.y, m: t.m - 1 }; return { from: fmt({ y: pm.y, m: pm.m, d: 1 }), to: fmt({ y: pm.y, m: pm.m, d: dim(pm.y, pm.m) }) }; }
        case 'this_year': return { from: fmt({ y: t.y, m: 1, d: 1 }), to: fmt(t) };
        case 'last_year': return { from: fmt({ y: t.y - 1, m: 1, d: 1 }), to: fmt({ y: t.y - 1, m: 12, d: 31 }) };
    }
}
const PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year'];

// ================================================================= 1. formatLocalDate
console.log('\n[' + TZNAME + '] formatLocalDate');
test('formats local components with zero padding', () => {
    assert.strictEqual(H.formatLocalDate(new RealDate(2026, 0, 5, 3, 4, 5)), '2026-01-05');
    assert.strictEqual(H.formatLocalDate(new RealDate(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});
test('local midnight and 23:59:59 stay on their own local day', () => {
    assert.strictEqual(H.formatLocalDate(new RealDate(2026, 8, 1, 0, 0, 0)), '2026-09-01');
    assert.strictEqual(H.formatLocalDate(new RealDate(2026, 8, 1, 23, 59, 59)), '2026-09-01');
});
test('invalid / non-Date input → empty string (never "NaN-NaN-NaN")', () => {
    [new RealDate('nope'), null, undefined, '2026-01-01', 12345, {}, []].forEach(v => assert.strictEqual(H.formatLocalDate(v), ''));
});
test('accepts a Date from another realm and a subclassed/mocked Date', () => {
    const foreign = vm.runInNewContext('new Date(2026, 5, 15, 12)');
    assert.strictEqual(H.formatLocalDate(foreign), '2026-06-15');
    class D2 extends RealDate {}
    assert.strictEqual(H.formatLocalDate(new D2(2026, 5, 15, 12)), '2026-06-15');
});

// ================================================================= 2. getTodayDate vs oracle
console.log('\n[' + TZNAME + '] getTodayDate — the LOCAL date, in every timezone');
const WINDOWS = ['2025-12-30T00:00:00Z', '2026-02-27T00:00:00Z', '2026-03-07T00:00:00Z', '2026-03-28T00:00:00Z', '2026-09-18T00:00:00Z',
    '2026-10-03T00:00:00Z', '2026-10-24T00:00:00Z', '2026-11-01T00:00:00Z', '2028-02-27T00:00:00Z'].map(s => RealDate.parse(s));
const STEP = 20 * 60000, SPAN = 5 * 86400000;
let instants = 0;
test('getTodayDate matches the oracle for every 20-minute instant across DST / month / year / leap boundaries', () => {
    let checked = 0;
    for (const w of WINDOWS) for (let ms = w; ms < w + SPAN; ms += STEP) {
        freezeNow(ms);
        const got = H.getTodayDate(), exp = fmt(localYmd(ms));
        assert.strictEqual(got, exp, `instant ${new RealDate(ms).toISOString()} in ${TZNAME}: got ${got}, expected ${exp}`);
        checked++;
    }
    instants = checked;
});
test('the original bug is gone: 02:00 local never reports yesterday (IST 02:00 = 20:30Z the day before)', () => {
    freezeNow(RealDate.parse('2026-09-18T20:30:00Z'));
    assert.strictEqual(H.getTodayDate(), fmt(localYmd(RealDate.parse('2026-09-18T20:30:00Z'))));
});

// ================================================================= 3. getDatePresetRange vs oracle
console.log('\n[' + TZNAME + '] getDatePresetRange — 8 presets × ' + '~3,200 instants');
test('every preset equals the oracle at every 20-minute instant (all boundaries, DST, leap day)', () => {
    let mismatches = [];
    for (const w of WINDOWS) for (let ms = w; ms < w + SPAN; ms += STEP) {
        const now = new RealDate(ms); const t = localYmd(ms);
        for (const p of PRESETS) {
            const got = H.getDatePresetRange(p, now), exp = expectedPreset(p, t);
            if (!got || got.from !== exp.from || got.to !== exp.to) mismatches.push(`${now.toISOString()} ${p}: got ${got && got.from}..${got && got.to} expected ${exp.from}..${exp.to}`);
        }
    }
    assert.strictEqual(mismatches.length, 0, mismatches.slice(0, 3).join('\n'));
});
test('with no argument it uses the current (frozen) time', () => {
    const ms = RealDate.parse('2026-09-19T04:30:00Z'); freezeNow(ms);
    const got = H.getDatePresetRange('this_month'), exp = expectedPreset('this_month', localYmd(ms));
    assert.deepStrictEqual({ from: got.from, to: got.to }, exp);
});
test('"custom", unknown, empty and undefined presets → null (user dates are not overwritten)', () => {
    ['custom', 'nonsense', '', undefined, null, 'TODAY'].forEach(p => assert.strictEqual(H.getDatePresetRange(p, new RealDate(2026, 8, 19)), null, String(p)));
});
test('invalid "now" falls back to the current time instead of returning NaN dates', () => {
    freezeNow(RealDate.parse('2026-09-19T06:00:00Z'));
    const r = H.getDatePresetRange('today', new RealDate('bad'));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.from) && !/NaN/.test(r.from + r.to));
});
// fixed, human-checkable expectations (a Saturday)
const FIXED = new RealDate(2026, 8, 19, 10, 0, 0);
[['today', '2026-09-19', '2026-09-19'], ['yesterday', '2026-09-18', '2026-09-18'], ['this_week', '2026-09-13', '2026-09-19'],
 ['last_week', '2026-09-06', '2026-09-12'], ['this_month', '2026-09-01', '2026-09-19'], ['last_month', '2026-08-01', '2026-08-31'],
 ['this_year', '2026-01-01', '2026-09-19'], ['last_year', '2025-01-01', '2025-12-31']].forEach(([p, f, t]) =>
    test(`Sat 2026-09-19 · ${p} = ${f} → ${t}`, () => { const r = H.getDatePresetRange(p, FIXED); assert.deepStrictEqual({ from: r.from, to: r.to }, { from: f, to: t }); }));
test('the exact IST bug: "This month" starts on the 1st, "This year" on Jan 1 (not the day before)', () => {
    assert.strictEqual(H.getDatePresetRange('this_month', FIXED).from, '2026-09-01');
    assert.strictEqual(H.getDatePresetRange('this_year', FIXED).from, '2026-01-01');
    assert.strictEqual(H.getDatePresetRange('last_month', FIXED).to, '2026-08-31');
    assert.strictEqual(H.getDatePresetRange('last_year', FIXED).to, '2025-12-31');
});
test('January: last_month = December of the previous year', () => {
    const r = H.getDatePresetRange('last_month', new RealDate(2026, 0, 15)); assert.deepStrictEqual({ f: r.from, t: r.to }, { f: '2025-12-01', t: '2025-12-31' });
});
test('March 1: last_month = February (28 days in 2026, 29 in 2028)', () => {
    assert.strictEqual(H.getDatePresetRange('last_month', new RealDate(2026, 2, 1)).to, '2026-02-28');
    assert.strictEqual(H.getDatePresetRange('last_month', new RealDate(2028, 2, 1)).to, '2028-02-29');
});
test('Sunday: this_week = just today; Jan 1: this_week reaches back into the previous year', () => {
    const sun = H.getDatePresetRange('this_week', new RealDate(2026, 8, 20)); assert.deepStrictEqual({ f: sun.from, t: sun.to }, { f: '2026-09-20', t: '2026-09-20' });
    const j1 = H.getDatePresetRange('this_week', new RealDate(2026, 0, 1)); assert.deepStrictEqual({ f: j1.from, t: j1.to }, { f: '2025-12-28', t: '2026-01-01' });
});
test('January 3 (Sat): last_week spans the year boundary', () => {
    const r = H.getDatePresetRange('last_week', new RealDate(2026, 0, 3)); assert.deepStrictEqual({ f: r.from, t: r.to }, { f: '2025-12-21', t: '2025-12-27' });
});

// ================================================================= 4. settings defaults
console.log('\n[' + TZNAME + '] settings defaults merge');
const DEFAULT_KEYS = ['id', 'agencyName', 'logoUrl', 'upiQrUrl', 'phone', 'email', 'website', 'address', 'taxRate', 'metaRate', 'currency', 'gstNumber', 'taxSettings',
    'invoicePrefix', 'quotePrefix', 'defaultQuoteValidity', 'defaultTerms', 'footerText', 'deliverables', 'themeMode', 'pinEnabled', 'pin', 'dateFormat', 'timeFormat',
    'aiProvider', 'aiApiKeyOpenAI', 'aiModelOpenAI', 'aiApiKeyGemini', 'aiModelGemini'];
test('getDefaultSettings has exactly the 29 documented fields with the original values', () => {
    const d = H.getDefaultSettings();
    assert.deepStrictEqual(Object.keys(d).sort(), DEFAULT_KEYS.slice().sort());
    assert.strictEqual(d.agencyName, 'Your Agency'); assert.strictEqual(d.taxRate, 18); assert.strictEqual(d.metaRate, 0.85); assert.strictEqual(d.currency, '₹');
    assert.strictEqual(d.themeMode, 'system'); assert.strictEqual(d.aiModelGemini, 'gemini-3.8-flash'); assert.deepStrictEqual(Array.from(d.deliverables), ['WhatsApp Setup', 'Facebook Ads', 'Automation Setup']);
    assert.strictEqual(d.pinEnabled, false); assert.strictEqual(d.pin, ''); assert.strictEqual(d.defaultQuoteValidity, 30);
});
test('each call returns a FRESH object (mutating one never changes the next)', () => {
    const a = H.getDefaultSettings(); a.deliverables.push('MUTATED'); a.agencyName = 'X';
    const b = H.getDefaultSettings(); assert.strictEqual(b.deliverables.length, 3); assert.strictEqual(b.agencyName, 'Your Agency'); assert.notStrictEqual(a.deliverables, b.deliverables);
});
const partial = { id: 'appSettings', migrated_v1: true, agencyName: 'Old Agency', taxRate: 12, currency: '$', darkMode: true, themeMode: 'dark', pinEnabled: true, pin: '4321' };
test('a PARTIAL record (like a migration/backup result) gets every missing default; stored values win', () => {
    const m = H.mergeSettingsWithDefaults(partial);
    DEFAULT_KEYS.forEach(k => assert.ok(m[k] !== undefined, 'missing ' + k));
    assert.strictEqual(m.agencyName, 'Old Agency'); assert.strictEqual(m.taxRate, 12); assert.strictEqual(m.currency, '$'); assert.strictEqual(m.themeMode, 'dark');
    assert.strictEqual(m.pinEnabled, true); assert.strictEqual(m.pin, '4321');
    assert.strictEqual(m.phone, ''); assert.strictEqual(m.quotePrefix, 'QT'); assert.strictEqual(m.defaultQuoteValidity, 30); assert.strictEqual(m.metaRate, 0.85);
});
test('extra stored keys are preserved (migrated_v1, darkMode, unknown future fields)', () => {
    const m = H.mergeSettingsWithDefaults(Object.assign({}, partial, { futureField: { a: 1 } }));
    assert.strictEqual(m.migrated_v1, true); assert.strictEqual(m.darkMode, true); assert.deepStrictEqual(JSON.parse(JSON.stringify(m.futureField)), { a: 1 });
});
test('FALSY stored values are real values and are never replaced: 0, "", false, empty list', () => {
    const m = H.mergeSettingsWithDefaults({ id: 'appSettings', taxRate: 0, metaRate: 0, agencyName: '', phone: '', pinEnabled: false, deliverables: [], defaultQuoteValidity: 0, currency: '' });
    assert.strictEqual(m.taxRate, 0); assert.strictEqual(m.metaRate, 0); assert.strictEqual(m.agencyName, ''); assert.strictEqual(m.pinEnabled, false);
    assert.deepStrictEqual(Array.from(m.deliverables), []); assert.strictEqual(m.defaultQuoteValidity, 0); assert.strictEqual(m.currency, '');
});
test('null and undefined count as "missing" and get the default', () => {
    const m = H.mergeSettingsWithDefaults({ id: 'appSettings', agencyName: null, currency: undefined, themeMode: null });
    assert.strictEqual(m.agencyName, 'Your Agency'); assert.strictEqual(m.currency, '₹'); assert.strictEqual(m.themeMode, 'system');
});
test('a corrupt non-list "deliverables" is replaced by the default list (the UI calls .map/.includes on it)', () => {
    ['text', 5, {}, true].forEach(v => { const m = H.mergeSettingsWithDefaults({ id: 'appSettings', deliverables: v }); assert.ok(Array.isArray(m.deliverables) && m.deliverables.length === 3, String(v)); });
});
test('merged records never share the default deliverables array', () => {
    const a = H.mergeSettingsWithDefaults({ id: 'appSettings' }), b = H.mergeSettingsWithDefaults({ id: 'appSettings' });
    a.deliverables.push('Z'); assert.strictEqual(b.deliverables.length, 3); assert.strictEqual(H.getDefaultSettings().deliverables.length, 3);
});
test('the id is always "appSettings"', () => {
    assert.strictEqual(H.mergeSettingsWithDefaults({ id: 'weird' }).id, 'appSettings');
});
test('the stored record object is not mutated', () => {
    const src = { id: 'appSettings', agencyName: 'A' }; const copy = JSON.stringify(src); H.mergeSettingsWithDefaults(src); assert.strictEqual(JSON.stringify(src), copy);
});
test('non-object input → plain defaults', () => {
    [undefined, null, [], 'x', 5].forEach(v => assert.deepStrictEqual(JSON.parse(JSON.stringify(H.mergeSettingsWithDefaults(v))), JSON.parse(JSON.stringify(H.getDefaultSettings()))));
});

// ================================================================= 5. AppState.loadSettings / saveSettings
console.log('\n[' + TZNAME + '] AppState.loadSettings');
(async () => {
    await atest('first run (no record): defaults are created AND saved exactly once', async () => {
        dbRecord = undefined; await AppState.loadSettings();
        assert.strictEqual(written.length, 1); assert.strictEqual(written[0].store, 'settings');
        assert.deepStrictEqual(Object.keys(AppState.settings).sort(), DEFAULT_KEYS.slice().sort());
        assert.strictEqual(document_theme(), 'light');
    });
    await atest('complete existing record: loaded unchanged, NOTHING written', async () => {
        dbRecord = H.getDefaultSettings(); dbRecord.agencyName = 'Mine'; await AppState.loadSettings();
        assert.strictEqual(written.length, 0); assert.strictEqual(AppState.settings.agencyName, 'Mine');
    });
    await atest('partial existing record: merged IN MEMORY; the database record is NOT rewritten', async () => {
        dbRecord = JSON.parse(JSON.stringify(partial)); const before = JSON.stringify(dbRecord); await AppState.loadSettings();
        assert.strictEqual(written.length, 0, 'loadSettings must not write when a record exists');
        assert.strictEqual(JSON.stringify(dbRecord), before);
        DEFAULT_KEYS.forEach(k => assert.ok(AppState.settings[k] !== undefined, 'missing ' + k));
        assert.strictEqual(AppState.settings.agencyName, 'Old Agency'); assert.strictEqual(AppState.settings.taxRate, 12);
    });
    await atest('theme is applied from a stored themeMode (dark) and from the default (system → light here)', async () => {
        dbRecord = { id: 'appSettings', themeMode: 'dark' }; await AppState.loadSettings(); assert.strictEqual(document_theme(), 'dark');
        dbRecord = { id: 'appSettings' }; await AppState.loadSettings(); assert.strictEqual(AppState.settings.themeMode, 'system'); assert.strictEqual(document_theme(), 'light');
    });
    await atest('saveSettings after a merged load persists the COMPLETE record', async () => {
        dbRecord = JSON.parse(JSON.stringify(partial)); await AppState.loadSettings(); AppState.settings.agencyName = 'Renamed'; await AppState.saveSettings();
        assert.strictEqual(written.length, 1); const saved = written[0].rec;
        DEFAULT_KEYS.forEach(k => assert.ok(saved[k] !== undefined, 'not persisted: ' + k)); assert.strictEqual(saved.agencyName, 'Renamed'); assert.strictEqual(saved.migrated_v1, true);
    });
    await atest('two loads give independent objects', async () => {
        dbRecord = { id: 'appSettings' }; await AppState.loadSettings(); const first = AppState.settings; first.deliverables.push('Q');
        await AppState.loadSettings(); assert.notStrictEqual(AppState.settings, first); assert.strictEqual(AppState.settings.deliverables.length, 3);
    });
    await atest('corrupt stored deliverables no longer breaks the settings object', async () => {
        dbRecord = { id: 'appSettings', deliverables: 'oops' }; await AppState.loadSettings(); assert.ok(Array.isArray(AppState.settings.deliverables));
    });

    // ------------------------------------------------------------- 6. untouched helpers still behave
    console.log('\n[' + TZNAME + '] other helpers unchanged');
    test('generateId / formatMoney / escapeHTML, saveSettings .. end of file (filterDataByDate, saveFileToDevice, showConfirm) are byte-identical to the original', () => {
        const orig = fs.readFileSync(process.env.ORIG_HELPERS || '/tmp/orig/js/utils/helpers.js', 'utf8');
        const now = fs.readFileSync(helpersFile, 'utf8');
        const slice = (src, from, to) => src.slice(src.indexOf(from), to === undefined ? undefined : src.indexOf(to));
        assert.strictEqual(slice(now, '// Generate random ID', '// True for a real'), slice(orig, '// Generate random ID', 'function getTodayDate'));
        assert.strictEqual(slice(now, '    async saveSettings() {'), slice(orig, '    async saveSettings() {'));
    });

    console.log('\n' + '='.repeat(60));
    console.log(`Phase 2 tests [${TZNAME}]: ${passed} passed, ${failed} failed  (${instants} instants swept)`);
    process.exit(failed ? 1 : 0);
})();
function document_theme() { return sandbox.document.documentElement.dataset.theme; }
