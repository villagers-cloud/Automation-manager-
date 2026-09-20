const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

// Mock window object to prevent errors when loading helpers.js
const windowMock = {
    matchMedia: () => ({
        matches: false,
        addEventListener: () => {}
    }),
    showSaveFilePicker: null
};

const sandbox = {
    window: windowMock,
    document: {
        documentElement: {
            dataset: {}
        },
        createElement: () => ({}),
        body: {
            appendChild: () => {},
            removeChild: () => {}
        }
    },
    URL: {
        createObjectURL: () => '',
        revokeObjectURL: () => {}
    },
    console: console,
    Date: Date,
    Math: Math,
    String: String,
    Number: Number,
    isNaN: isNaN
};

vm.createContext(sandbox);

// Load helpers.js
const scriptPath = path.join(__dirname, '../js/utils/helpers.js');
const code = fs.readFileSync(scriptPath, 'utf8');
vm.runInContext(code, sandbox);

// =========================================================
// Tests for generateId()
// =========================================================

const generateId = sandbox.generateId;

function runTests() {
    console.log('Running tests for generateId()...\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (e) {
            console.error(`❌ FAIL: ${name}`);
            console.error(e);
            failed++;
        }
    }

    test('should return a string', () => {
        const id = generateId();

        assert.strictEqual(
            typeof id,
            'string',
            `Expected string, got ${typeof id}`
        );
    });

    test('should be alphanumeric', () => {
        const id = generateId();

        assert.match(
            id,
            /^[a-z0-9]+$/,
            `ID ${id} contains non-alphanumeric characters`
        );
    });

    test('should generate unique IDs', () => {
        const iterations = 10000;
        const ids = new Set();

        for (let i = 0; i < iterations; i++) {
            const id = generateId();

            if (ids.has(id)) {
                assert.fail(
                    `Duplicate ID generated: ${id} at iteration ${i}`
                );
            }

            ids.add(id);
        }

        assert.strictEqual(
            ids.size,
            iterations,
            `Expected ${iterations} unique IDs, got ${ids.size}`
        );
    });

    console.log(`\nTest Summary generateId: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();

// =========================================================
// Tests for filterDataByDate
// =========================================================

console.log('\nRunning tests for filterDataByDate...\n');

const filterDataByDate = sandbox.filterDataByDate;

// Initialize AppFilter
if (!windowMock.AppFilter) {
    windowMock.AppFilter = {
        active: false,
        fromDate: '',
        toDate: '',
        fromTime: '',
        toTime: ''
    };
}

const AppFilter = windowMock.AppFilter;

let fdPassed = 0;
let fdFailed = 0;

function resetAppFilter() {
    AppFilter.active = false;
    AppFilter.fromDate = '';
    AppFilter.toDate = '';
    AppFilter.fromTime = '';
    AppFilter.toTime = '';
}

function runFdTest(name, testFn) {
    try {
        resetAppFilter();
        testFn();

        console.log(`✅ PASS: ${name}`);
        fdPassed++;
    } catch (error) {
        console.error(`❌ FAIL: ${name}`);
        console.error(error);
        fdFailed++;
    }
}

const testData = [
    {
        id: 1,
        date: '2023-10-01T10:00:00'
    },
    {
        id: 2,
        date: '2023-10-05T15:30:00'
    },
    {
        id: 3,
        date: '2023-10-10T08:15:00'
    },
    {
        id: 4,
        date: '2023-10-15T20:45:00'
    },
    {
        id: 5,
        date: '2023-10-20T12:00:00'
    }
];

runFdTest('Empty/no filter returns all data', () => {
    AppFilter.active = false;

    const result = filterDataByDate(testData);

    assert.strictEqual(result.length, testData.length);
});

runFdTest('From date only filtering', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-10';

    const result = filterDataByDate(testData);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [3, 4, 5]
    );
});

runFdTest('To date only filtering', () => {
    AppFilter.active = true;
    AppFilter.toDate = '2023-10-10';

    const result = filterDataByDate(testData);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [1, 2, 3]
    );
});

runFdTest('From + To date range filtering', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-05';
    AppFilter.toDate = '2023-10-15';

    const result = filterDataByDate(testData);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [2, 3, 4]
    );
});

runFdTest(
    'Exact boundary dates include the entire selected day',
    () => {
        AppFilter.active = true;
        AppFilter.fromDate = '2023-10-05';
        AppFilter.toDate = '2023-10-05';

        const result = filterDataByDate(testData);

        assert.deepStrictEqual(
            result.map(d => d.id),
            [2]
        );
    }
);

runFdTest('Time filtering', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-10';
    AppFilter.fromTime = '09:00:00';
    AppFilter.toDate = '2023-10-10';
    AppFilter.toTime = '12:00:00';

    const timeData = [
        {
            id: 1,
            date: '2023-10-10T08:30:00'
        },
        {
            id: 2,
            date: '2023-10-10T10:00:00'
        },
        {
            id: 3,
            date: '2023-10-10T13:00:00'
        }
    ];

    const result = filterDataByDate(timeData);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [2]
    );
});

runFdTest('Empty dataset', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-01';

    const result = filterDataByDate([]);

    assert.deepStrictEqual(result, []);
});

runFdTest(
    'Missing/null/undefined date fields fallback to created or return true',
    () => {
        AppFilter.active = true;
        AppFilter.fromDate = '2023-10-10';
        AppFilter.toDate = '2023-10-20';

        const weirdData = [
            {
                id: 1
            },
            {
                id: 2,
                date: null,
                created: '2023-10-15T00:00:00'
            },
            {
                id: 3,
                date: undefined,
                created: '2023-10-05T00:00:00'
            },
            {
                id: 4,
                date: '',
                created: ''
            }
        ];

        const result = filterDataByDate(weirdData);

        assert.deepStrictEqual(
            result.map(d => d.id),
            [1, 2, 4]
        );
    }
);

runFdTest('Invalid date values/formats return true', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-10';
    AppFilter.toDate = '2023-10-20';

    const invalidDates = [
        {
            id: 1,
            date: 'invalid-date'
        },
        {
            id: 2,
            date: '2023-13-45'
        }
    ];

    const result = filterDataByDate(invalidDates);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [1, 2]
    );
});

runFdTest('Records with the same boundary date/time', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-10';
    AppFilter.fromTime = '10:00:00';
    AppFilter.toDate = '2023-10-10';
    AppFilter.toTime = '10:00:00';

    const exactData = [
        {
            id: 1,
            date: '2023-10-10T10:00:00'
        },
        {
            id: 2,
            date: '2023-10-10T09:59:59'
        },
        {
            id: 3,
            date: '2023-10-10T10:00:01'
        }
    ];

    const result = filterDataByDate(exactData);

    assert.deepStrictEqual(
        result.map(d => d.id),
        [1]
    );
});

runFdTest('Different custom dateField', () => {
    AppFilter.active = true;
    AppFilter.fromDate = '2023-10-10';

    const customData = [
        {
            id: 1,
            invoiceDate: '2023-10-05T00:00:00'
        },
        {
            id: 2,
            invoiceDate: '2023-10-15T00:00:00'
        }
    ];

    const result = filterDataByDate(
        customData,
        'invoiceDate'
    );

    assert.deepStrictEqual(
        result.map(d => d.id),
        [2]
    );
});

console.log(
    `\nTest Summary filterDataByDate: ${fdPassed} passed, ${fdFailed} failed`
);

if (fdFailed > 0) {
    process.exit(1);
}

// =========================================================
// Tests for getTodayDate
// =========================================================

console.log('\nRunning tests for getTodayDate...\n');

const getTodayDate = sandbox.getTodayDate;
const OriginalDate = sandbox.Date;

let gtdPassed = 0;
let gtdFailed = 0;

function runGtdTest(name, testFn) {
    try {
        testFn();

        console.log(`✅ PASS: ${name}`);
        gtdPassed++;
    } catch (error) {
        console.error(`❌ FAIL: ${name}`);
        console.error(error);
        gtdFailed++;
    } finally {
        // Always restore the original Date constructor.
        sandbox.Date = OriginalDate;
    }
}

// getTodayDate() must return the LOCAL calendar date of the device (not the UTC date).
// Every mock instant below is built from LOCAL components, so these tests pass in ANY timezone.
function mockNow(localDate) {
    sandbox.Date = class extends OriginalDate {
        constructor(...args) {
            if (args.length === 0) {
                return localDate;
            }

            return new OriginalDate(...args);
        }

        static now() {
            return localDate.getTime();
        }
    };
}

runGtdTest(
    'should return the current LOCAL date in YYYY-MM-DD format',
    () => {
        mockNow(new OriginalDate(2023, 9, 25, 14, 30, 0));

        assert.strictEqual(sandbox.getTodayDate(), '2023-10-25');
    }
);

runGtdTest(
    'should handle leap years correctly',
    () => {
        mockNow(new OriginalDate(2024, 1, 29, 10, 0, 0));

        assert.strictEqual(sandbox.getTodayDate(), '2024-02-29');
    }
);

runGtdTest(
    'should return the local day (not the UTC day) shortly after local midnight',
    () => {
        // 00:30 local. In any timezone east of UTC the UTC date is still "yesterday".
        mockNow(new OriginalDate(2023, 9, 26, 0, 30, 0));

        assert.strictEqual(sandbox.getTodayDate(), '2023-10-26');
    }
);

runGtdTest(
    'should return the local day (not the UTC day) late in the local evening',
    () => {
        // 23:45 local. In any timezone west of UTC the UTC date is already "tomorrow".
        mockNow(new OriginalDate(2023, 9, 25, 23, 45, 0));

        assert.strictEqual(sandbox.getTodayDate(), '2023-10-25');
    }
);

runGtdTest(
    'should zero-pad month and day and handle the year boundary',
    () => {
        mockNow(new OriginalDate(2026, 0, 5, 0, 0, 0));
        assert.strictEqual(sandbox.getTodayDate(), '2026-01-05');

        mockNow(new OriginalDate(2025, 11, 31, 23, 59, 59));
        assert.strictEqual(sandbox.getTodayDate(), '2025-12-31');
    }
);

console.log(
    `\nTest Summary getTodayDate: ${gtdPassed} passed, ${gtdFailed} failed`
);

if (gtdFailed > 0) {
    process.exit(1);
}

console.log('\n🎉 All tests passed successfully!');
