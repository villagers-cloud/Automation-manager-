const assert = require('assert');
const { execSync } = require('child_process');
const http = require('http');

console.log('=== RUNNING AUTOMATION MANAGER COMPREHENSIVE TEST SUITE ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`[PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`[FAIL] ${name}: ${err.message}`);
        console.error(err.stack);
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`[PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`[FAIL] ${name}: ${err.message}`);
        console.error(err.stack);
    }
}

// ----------------------------------------------------
// 1. JavaScript Syntax Checks
// ----------------------------------------------------
runTest('1. JS Syntax Check (Node --check)', () => {
    const files = [
        'js/app.js',
        'js/db/database.js',
        'js/utils/helpers.js',
        'js/utils/migration.js',
        'js/ui/navigation.js',
        'js/views/dashboard.js',
        'js/views/clients.js',
        'js/views/services.js',
        'js/views/quotes.js',
        'js/views/projects.js',
        'js/views/billing.js',
        'js/views/team_notes.js',
        'js/views/reports_settings.js',
        'sw.js',
        'server/config.js',
        'server/middleware.js',
        'server/index.js'
    ];
    execSync(`node --check ${files.join(' ')}`);
});

// Mock window object and appRouter for Node test execution
global.window = {
    appRouter: { addRoute: () => {} }
};
global.DB_NAME = 'AutomationManagerDB';
global.DB_VERSION = 1;
require('../js/views/reports_settings.js');

const { BackupTools, SettingsTools, ReportTools } = global.window;

// ----------------------------------------------------
// 2. BackupTools Validation & CSV Tests
// ----------------------------------------------------
runTest('2. BackupTools: Validate Valid Backup', () => {
    const validBackup = {
        meta: { app: 'Automation Manager', schemaVersion: 2, counts: { clients: 1, settings: 1 } },
        settings: [{ id: 'appSettings' }],
        clients: [{ id: 'c1', name: 'Test Client' }],
        services: [],
        quotes: [],
        projects: [],
        tasks: [],
        invoices: [],
        payments: [],
        expenses: [],
        team: [],
        notes: []
    };
    const res = BackupTools.validateBackup(validBackup);
    assert.strictEqual(res.ok, true, 'Valid backup should pass validation');
});

runTest('3. BackupTools: Reject Corrupt or Invalid Backups', () => {
    // Missing stores
    const invalid1 = { meta: { app: 'Automation Manager' } };
    assert.strictEqual(BackupTools.validateBackup(invalid1).ok, false, 'Missing stores should fail');

    // Duplicate IDs
    const invalid2 = {
        meta: { app: 'Automation Manager' },
        settings: [],
        clients: [{ id: 'c1', name: 'Client 1' }, { id: 'c1', name: 'Client 2' }],
        services: [], quotes: [], projects: [], tasks: [], invoices: [], payments: [], expenses: [], team: [], notes: []
    };
    assert.strictEqual(BackupTools.validateBackup(invalid2).ok, false, 'Duplicate IDs should fail');

    // Wrong app name
    const invalid3 = {
        meta: { app: 'Other App' },
        settings: [], clients: [], services: [], quotes: [], projects: [], tasks: [], invoices: [], payments: [], expenses: [], team: [], notes: []
    };
    assert.strictEqual(BackupTools.validateBackup(invalid3).ok, false, 'Wrong app name should fail');
});

runTest('4. BackupTools: CSV Generation RFC 4180 with UTF-8 BOM', () => {
    const data = [
        { name: 'A & B Co', amount: 1500.50, notes: 'Includes "quotes" & Gujarati ₹' }
    ];
    const csv = BackupTools.buildCsv(data);
    assert.ok(csv.text.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
    assert.ok(csv.text.includes('"Includes ""quotes"" & Gujarati ₹"'), 'Quotes must be properly escaped');
});

runTest('5. BackupTools: Strip Secrets from Backup Object', () => {
    const record = {
        id: 'appSettings',
        agencyName: 'My Agency',
        aiApiKeyOpenAI: 'sk-secret123',
        pin: '1234'
    };
    const stripped = BackupTools.stripSecrets(record);
    assert.strictEqual(stripped.agencyName, 'My Agency');
    assert.strictEqual(stripped.aiApiKeyOpenAI, undefined);
    assert.strictEqual(stripped.pin, undefined);
});

// ----------------------------------------------------
// 3. SettingsTools Tests
// ----------------------------------------------------
runTest('6. SettingsTools: PIN Validation and Lock Rule', () => {
    assert.strictEqual(SettingsTools.isValidPin('1234'), true);
    assert.strictEqual(SettingsTools.isValidPin('123'), false);
    assert.strictEqual(SettingsTools.isValidPin('abcd'), false);

    assert.strictEqual(SettingsTools.isPinLockEffective({ pinEnabled: true, pin: '1234' }), true);
    assert.strictEqual(SettingsTools.isPinLockEffective({ pinEnabled: true, pin: '123' }), false);
    assert.strictEqual(SettingsTools.isPinLockEffective({ pinEnabled: false, pin: '1234' }), false);
});

runTest('7. SettingsTools: Resolve PIN Preference', () => {
    // Want ON with invalid PIN input -> error
    const r1 = SettingsTools.resolvePinPreference({ wantEnabled: true, enteredPin: 'abc', storedPin: '' });
    assert.strictEqual(r1.ok, false);

    // Want ON with valid 4-digit PIN -> ok, enabled
    const r2 = SettingsTools.resolvePinPreference({ wantEnabled: true, enteredPin: '5678', storedPin: '' });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.enabled, true);
    assert.strictEqual(r2.pin, '5678');

    // Want OFF -> ok, disabled
    const r3 = SettingsTools.resolvePinPreference({ wantEnabled: false, enteredPin: '', storedPin: '5678' });
    assert.strictEqual(r3.ok, true);
    assert.strictEqual(r3.enabled, false);
});

// ----------------------------------------------------
// 4. Server Proxy Tests
// ----------------------------------------------------
const server = require('../server/index.js');

async function testServerProxy() {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    function makeRequest(path, options = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request(`${baseUrl}${path}`, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
            });
            req.on('error', reject);
            if (options.body) req.write(options.body);
            req.end();
        });
    }

    await runAsyncTest('8. Server Proxy: GET /api/health Endpoint', async () => {
        const res = await makeRequest('/api/health');
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.headers['x-content-type-options'], 'nosniff');
        const json = JSON.parse(res.body);
        assert.strictEqual(json.status, 'ok');
        assert.strictEqual(json.service, 'Automation Manager Secure Proxy');
    });

    await runAsyncTest('9. Server Proxy: Reject Disallowed Methods', async () => {
        const res = await makeRequest('/api/health', { method: 'DELETE' });
        assert.strictEqual(res.statusCode, 405);
    });

    await runAsyncTest('10. Server Proxy: Reject Open Proxy Query Requests', async () => {
        const res = await makeRequest('/api/proxy?url=https://evil.com');
        assert.strictEqual(res.statusCode, 400);
        const json = JSON.parse(res.body);
        assert.strictEqual(json.error, 'Arbitrary open proxy requests are forbidden');
    });

    await runAsyncTest('11. Server Proxy: Reject Unknown Routes', async () => {
        const res = await makeRequest('/api/unknown');
        assert.strictEqual(res.statusCode, 404);
    });

    server.close();
}

// Execute async server tests
testServerProxy().then(() => {
    console.log(`\n=== TEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED ===`);
    if (passedTests !== totalTests) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}).catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
