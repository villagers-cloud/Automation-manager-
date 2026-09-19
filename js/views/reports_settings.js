// ============================================================================
// BackupTools — Phase 1 (data safety)
// Pure helpers for JSON backup / restore and CSV export. Used by the Data page.
//  - validateBackup / parseBackupText : validate a backup BEFORE touching IndexedDB
//  - buildBackupObject                : creates a versioned backup WITHOUT secrets
//  - readAllStores                    : reads every store in ONE read transaction
//  - replaceAllStores                 : restores every store in ONE readwrite transaction
//  - buildCsv                         : RFC 4180 CSV (union of keys, BOM, nested JSON)
// ============================================================================
window.BackupTools = (function () {
    const APP_NAME = 'Automation Manager';
    const BACKUP_FORMAT = 'automation-manager-backup';
    const SCHEMA_VERSION = 2; // 1 = legacy flat backup (no "meta" section)
    const STORES = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes'];

    // Device-local secrets: never written to a backup file, never overwritten by a restore
    // (unless the user explicitly chooses to restore them from an older backup file).
    const SECRET_SETTING_FIELDS = ['aiApiKeyOpenAI', 'aiApiKeyGemini', 'pin', 'pinEnabled'];

    // Fields the UI calls string methods on (crashes the page if missing) — a record without them is malformed.
    const REQUIRED_TEXT_FIELDS = { clients: ['name'], projects: ['name'], team: ['name'] };

    const CSV_LABELS = {
        clients: 'Clients',
        quotes: 'Quotes',
        invoices: 'Invoices',
        expenses: 'Expenses',
        projects: 'Projects',
        payments: 'Payments'
    };

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function isValidId(id) {
        return (typeof id === 'string' && id.trim().length > 0) || (typeof id === 'number' && isFinite(id));
    }

    // ---------------------------------------------------------------- validation
    function validateBackup(backup) {
        const errors = [];
        const warnings = [];
        const counts = {};

        if (!isPlainObject(backup)) {
            return { ok: false, errors: ['The file must contain a JSON object (a backup exported by this app).'], warnings, counts, meta: null };
        }

        let meta = null;
        if (backup.meta !== undefined) {
            if (!isPlainObject(backup.meta)) {
                errors.push('The "meta" section is malformed.');
            } else {
                meta = backup.meta;
                if (meta.app !== undefined && meta.app !== APP_NAME) {
                    errors.push('This file was not created by ' + APP_NAME + '.');
                }
                if (meta.schemaVersion !== undefined) {
                    const sv = meta.schemaVersion;
                    if (!Number.isInteger(sv) || sv < 1) {
                        errors.push('The backup schema version is invalid.');
                    } else if (sv > SCHEMA_VERSION) {
                        errors.push('This backup was created by a newer version of the app (schema ' + sv + '). Update the app first.');
                    }
                }
            }
        }

        STORES.forEach(store => {
            const rows = backup[store];
            if (rows === undefined) {
                errors.push('Store "' + store + '" is missing from the backup.');
                return;
            }
            if (!Array.isArray(rows)) {
                errors.push('Store "' + store + '" is not a list of records.');
                return;
            }
            counts[store] = rows.length;

            const seen = new Set();
            rows.forEach((rec, i) => {
                const where = store + '[' + i + ']';
                if (!isPlainObject(rec)) {
                    errors.push(where + ' is not a valid record.');
                    return;
                }
                if (!isValidId(rec.id)) {
                    errors.push(where + ' has no valid "id".');
                    return;
                }
                // IndexedDB treats the number 1 and the string "1" as different keys
                const key = typeof rec.id + ':' + rec.id;
                if (seen.has(key)) {
                    errors.push(where + ' repeats the id "' + rec.id + '" (one record would silently overwrite the other).');
                }
                seen.add(key);

                (REQUIRED_TEXT_FIELDS[store] || []).forEach(field => {
                    if (typeof rec[field] !== 'string') {
                        errors.push(where + ' is missing the text field "' + field + '".');
                    }
                });
                if (store === 'quotes') {
                    ['deliverables', 'expenses'].forEach(field => {
                        if (rec[field] !== undefined && rec[field] !== null && !Array.isArray(rec[field])) {
                            errors.push(where + ' has an invalid "' + field + '" (must be a list).');
                        }
                    });
                }
            });
        });

        if (Array.isArray(backup.settings)) {
            if (backup.settings.length > 1) {
                errors.push('Store "settings" must contain at most one record.');
            }
            backup.settings.forEach((rec, i) => {
                if (isPlainObject(rec)) {
                    if (rec.id !== undefined && isValidId(rec.id) && rec.id !== 'appSettings') {
                        errors.push('settings[' + i + '] must have the id "appSettings".');
                    }
                    if (rec.deliverables !== undefined && !Array.isArray(rec.deliverables)) {
                        errors.push('settings[' + i + '] has an invalid "deliverables" (must be a list).');
                    }
                }
            });
        }

        // If the backup declares how many records each store has, they must match (detects truncated/edited files)
        if (meta && isPlainObject(meta.counts)) {
            STORES.forEach(store => {
                const declared = meta.counts[store];
                if (typeof declared === 'number' && counts[store] !== undefined && declared !== counts[store]) {
                    errors.push('Store "' + store + '" contains ' + counts[store] + ' records but the backup declares ' + declared + ' — the file may be incomplete or edited.');
                }
            });
        }

        Object.keys(backup).forEach(k => {
            if (k !== 'meta' && STORES.indexOf(k) === -1) {
                warnings.push('Section "' + k + '" is not part of a restore and will be ignored.');
            }
        });

        return { ok: errors.length === 0, errors, warnings, counts, meta };
    }

    function parseBackupText(text) {
        if (typeof text !== 'string' || text.trim() === '') {
            return { ok: false, errors: ['The file is empty.'], warnings: [], counts: {}, meta: null, backup: null };
        }
        let parsed;
        try {
            parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
        } catch (e) {
            return { ok: false, errors: ['The file is not valid JSON (' + e.message + ').'], warnings: [], counts: {}, meta: null, backup: null };
        }
        const result = validateBackup(parsed);
        result.backup = result.ok ? parsed : null;
        return result;
    }

    function summarizeErrors(errors, limit) {
        const max = limit || 8;
        const shown = errors.slice(0, max);
        if (errors.length > max) shown.push('…and ' + (errors.length - max) + ' more problem(s).');
        return shown.join('\n');
    }

    // ---------------------------------------------------------------- backup (export)
    function stripSecrets(record) {
        const copy = Object.assign({}, record);
        SECRET_SETTING_FIELDS.forEach(f => { delete copy[f]; });
        return copy;
    }

    function buildBackupObject(all, now) {
        const stamp = (now instanceof Date ? now : new Date()).toISOString();
        const data = {};
        const counts = {};
        STORES.forEach(store => {
            if (!Array.isArray(all[store])) {
                throw new Error('Store "' + store + '" could not be read, so the backup would be incomplete.');
            }
            data[store] = store === 'settings' ? all[store].map(stripSecrets) : all[store];
            counts[store] = data[store].length;
        });
        const meta = {
            app: APP_NAME,
            format: BACKUP_FORMAT,
            schemaVersion: SCHEMA_VERSION,
            exportedAt: stamp,
            dbName: typeof DB_NAME !== 'undefined' ? DB_NAME : null,
            dbVersion: typeof DB_VERSION !== 'undefined' ? DB_VERSION : null,
            counts: counts,
            secretsExcluded: SECRET_SETTING_FIELDS.slice()
        };
        return Object.assign({ meta: meta }, data);
    }

    function readAllStores() {
        if (typeof initDB !== 'function') return Promise.reject(new Error('The database is not available.'));
        return initDB().then(db => new Promise((resolve, reject) => {
            const out = {};
            let tx;
            try {
                tx = db.transaction(STORES, 'readonly');
            } catch (e) {
                reject(e);
                return;
            }
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error || new Error('Reading the database failed.'));
            tx.onabort = () => reject(tx.error || new Error('Reading the database was aborted.'));
            STORES.forEach(store => {
                const req = tx.objectStore(store).getAll();
                req.onsuccess = () => { out[store] = req.result; };
            });
        }));
    }

    // ---------------------------------------------------------------- restore (import)
    function settingsHaveCredentials(rec) {
        if (!isPlainObject(rec)) return false;
        return ['aiApiKeyOpenAI', 'aiApiKeyGemini', 'pin'].some(f => typeof rec[f] === 'string' && rec[f] !== '') || rec.pinEnabled === true;
    }

    function mergeSettingsForRestore(backupSettings, localSettings, options) {
        const restoreCredentials = !!(options && options.restoreCredentials);
        const merged = Object.assign({}, backupSettings);
        merged.id = 'appSettings';
        SECRET_SETTING_FIELDS.forEach(f => {
            if (restoreCredentials && merged[f] !== undefined) return; // explicit choice: take the value from the file
            const local = localSettings ? localSettings[f] : undefined;
            if (local !== undefined) merged[f] = local;
            else merged[f] = (f === 'pinEnabled') ? false : '';
        });
        // never lose the "legacy data already migrated" marker (would let old localStorage data come back)
        if (!merged.migrated_v1 && localSettings && localSettings.migrated_v1) merged.migrated_v1 = true;
        return merged;
    }

    // Replaces ALL stores inside a single IndexedDB transaction. If anything fails the
    // transaction is aborted and IndexedDB rolls back: existing data is left untouched.
    async function replaceAllStores(backup, options) {
        // 1. Re-validate here too, so no caller can bypass validation
        const check = validateBackup(backup);
        if (!check.ok) throw new Error('Invalid backup: ' + check.errors[0]);
        if (typeof initDB !== 'function') throw new Error('The database is not available.');

        const db = await initDB();
        const local = await window.appDB.get('settings', 'appSettings');

        // 2. Build the complete plan in memory (nothing written yet)
        const plan = {};
        STORES.forEach(store => { plan[store] = backup[store]; });
        if (backup.settings.length > 0) {
            plan.settings = [mergeSettingsForRestore(backup.settings[0], local, options)];
        } else {
            plan.settings = local ? [local] : [];
        }

        // 3. One transaction: clear + put for every store, all-or-nothing
        return new Promise((resolve, reject) => {
            let failure = null;
            let tx;
            try {
                tx = db.transaction(STORES, 'readwrite');
            } catch (e) {
                reject(e);
                return;
            }
            tx.oncomplete = () => {
                const counts = {};
                STORES.forEach(s => { counts[s] = plan[s].length; });
                resolve({ counts: counts });
            };
            tx.onabort = () => reject(failure || tx.error || new Error('The restore transaction was aborted.'));
            try {
                STORES.forEach(store => {
                    const os = tx.objectStore(store);
                    os.clear();
                    plan[store].forEach(rec => { os.put(rec); });
                });
            } catch (e) {
                failure = e;
                try { tx.abort(); } catch (ignore) { /* already finished */ }
            }
        });
    }

    // ---------------------------------------------------------------- CSV
    function csvEscape(value) {
        let s;
        if (value === null || value === undefined) {
            s = '';
        } else if (value instanceof Date) {
            s = isNaN(value.getTime()) ? '' : value.toISOString();
        } else if (typeof value === 'object') {
            try { s = JSON.stringify(value); } catch (e) { s = String(value); }
        } else {
            s = String(value);
        }
        if (s === undefined) s = '';
        if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function buildCsv(records) {
        const headers = [];
        const seen = new Set();
        records.forEach(r => {
            if (isPlainObject(r)) {
                Object.keys(r).forEach(k => {
                    if (!seen.has(k)) { seen.add(k); headers.push(k); }
                });
            }
        });
        const lines = [headers.map(csvEscape).join(',')];
        records.forEach(r => {
            lines.push(headers.map(h => csvEscape(isPlainObject(r) ? r[h] : undefined)).join(','));
        });
        // UTF-8 BOM so Excel / Android apps read Gujarati and ₹ correctly; CRLF per RFC 4180
        return { headers: headers, rowCount: records.length, text: '\uFEFF' + lines.join('\r\n') + '\r\n' };
    }

    function emptyCsvMessage(store) {
        const label = CSV_LABELS[store] || store;
        return 'No ' + label + ' records to export — this list is empty. Your other data is not affected.';
    }

    return {
        STORES: STORES,
        SECRET_SETTING_FIELDS: SECRET_SETTING_FIELDS,
        SCHEMA_VERSION: SCHEMA_VERSION,
        CSV_LABELS: CSV_LABELS,
        validateBackup: validateBackup,
        parseBackupText: parseBackupText,
        summarizeErrors: summarizeErrors,
        stripSecrets: stripSecrets,
        buildBackupObject: buildBackupObject,
        readAllStores: readAllStores,
        settingsHaveCredentials: settingsHaveCredentials,
        mergeSettingsForRestore: mergeSettingsForRestore,
        replaceAllStores: replaceAllStores,
        csvEscape: csvEscape,
        buildCsv: buildCsv,
        emptyCsvMessage: emptyCsvMessage
    };
})();

// Reports View
window.appRouter.addRoute('reports', async () => {
    const container = document.getElementById('page-reports');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Business Reports</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            </div>

            <div class="grid">
                <div class="col-6 metric">
                    <div class="metric-label">Total Revenue (Paid)</div>
                    <div class="metric-value" id="repRev">₹0</div>
                </div>
                <div class="col-6 metric loss">
                    <div class="metric-label">Total Expenses</div>
                    <div class="metric-value" id="repExp" style="color:var(--red)">₹0</div>
                </div>
                <div class="col-12 metric neutral">
                    <div class="metric-label">Net Profit (Cash basis)</div>
                    <div class="metric-value" id="repNet">₹0</div>
                </div>
            </div>

            <div class="grid" style="margin-top:20px">
                <div class="col-4 metric" style="background:var(--bg); border:none">
                    <div class="metric-label">Active Clients</div>
                    <div class="metric-value" style="font-size:20px" id="repClients">0</div>
                </div>
                <div class="col-4 metric" style="background:var(--bg); border:none">
                    <div class="metric-label">Active Projects</div>
                    <div class="metric-value" style="font-size:20px" id="repProjects">0</div>
                </div>
                <div class="col-4 metric" style="background:var(--bg); border:none">
                    <div class="metric-label">Total Quotes</div>
                    <div class="metric-value" style="font-size:20px" id="repQuotes">0</div>
                </div>
            </div>

            <div style="margin-top:20px; font-size:12px; color:var(--muted); text-align:center;">
                Note: This is a simplified cash-flow report based on recorded Payments and Expenses.
            </div>
        </div>
    `;

    document.getElementById('repRev').textContent = 'Loading...';
    document.getElementById('repExp').textContent = 'Loading...';
    document.getElementById('repNet').textContent = 'Loading...';
    document.getElementById('repClients').textContent = '...';
    document.getElementById('repProjects').textContent = '...';
    document.getElementById('repQuotes').textContent = '...';

    try {
        const [allPayments, allExpenses, allClients, allProjects, allQuotes] = await Promise.all([
            window.appDB.getAll('payments'),
            window.appDB.getAll('expenses'),
            window.appDB.getAll('clients'),
            window.appDB.getAll('projects'),
            window.appDB.getAll('quotes')
        ]);

        const payments = filterDataByDate(allPayments, 'date');
        const expenses = filterDataByDate(allExpenses, 'date');
        const clients = filterDataByDate(allClients, 'dateAdded');
        const projects = filterDataByDate(allProjects, 'startDate');
        const quotes = filterDataByDate(allQuotes, 'date');

        const rev = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const exp = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const net = rev - exp;

        document.getElementById('repRev').textContent = formatMoney(rev, window.AppState.settings.currency);
        document.getElementById('repExp').textContent = formatMoney(exp, window.AppState.settings.currency);
        const netEl = document.getElementById('repNet');
        netEl.textContent = formatMoney(net, window.AppState.settings.currency);
        netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';

        document.getElementById('repClients').textContent = clients.filter(c => c.status !== 'Inactive').length;
        document.getElementById('repProjects').textContent = projects.filter(p => p.status === 'In Progress' || p.status === 'Planning').length;
        document.getElementById('repQuotes').textContent = quotes.length;
    } catch (e) {
        console.error("Failed to load reports data:", e);
        document.getElementById('repRev').textContent = 'Error loading data';
        document.getElementById('repExp').textContent = 'Error loading data';
        document.getElementById('repNet').textContent = 'Error loading data';
    }
});

// Settings & Data View
window.appRouter.addRoute('settings', async () => {
    if (!window.AppState.settings) {
        await window.AppState.loadSettings();
    }
    const container = document.getElementById('page-settings');
    container.innerHTML = `
      <div class="grid">
        <div class="col-6 card">
          <h2>Agency Profile</h2>
          <div class="field"><label>Agency Name</label><input id="set-agencyName"></div>
          <div class="field">
            <label>Logo URL</label><input id="set-logoUrl" placeholder="https://…">
          </div>
          <div class="field"><label>UPI QR Code Image URL</label><input id="set-upiQrUrl" placeholder="https://…"></div>
          <button class="btn green" id="saveProfileBtn">Save Profile</button>
        </div>

        <div class="col-6 card">
          <h2>Pricing Defaults</h2>
          <div class="row">
            <div class="field"><label>Default Tax %</label><input type="number" id="set-taxRate" min="0" step=".01"></div>
            <div class="field"><label>Meta Message Rate</label><input type="number" id="set-metaRate" min="0" step=".0001"></div>
          </div>
          <div class="row">
            <div class="field">
              <label>Currency Symbol</label>
              <select id="set-currency">
                <option value="₹">₹</option><option value="$">$</option><option value="€">€</option><option value="£">£</option>
              </select>
            </div>
            <div class="field"><label>Invoice Prefix</label><input id="set-invoicePrefix"></div>
          </div>
          <button class="btn green" id="savePricingBtn">Save Pricing</button>
        </div>

        <div class="col-6 card">
          <h2>App Preferences</h2>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
            <div><div style="font-weight:700">Dark Mode</div><div class="subtitle">Use a low-glare dark interface.</div></div>
            <input type="checkbox" id="set-darkMode" style="width:auto; transform:scale(1.5)">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
            <div><div style="font-weight:700">Require PIN on Open</div><div class="subtitle">Ask for PIN every time app starts.</div></div>
            <input type="checkbox" id="set-pinEnabled" style="width:auto; transform:scale(1.5)">
          </div>
          <div class="field">
            <label>4-Digit App PIN</label>
            <input type="password" id="set-appPin" inputmode="numeric" maxlength="4" placeholder="Leave blank to keep current">
          </div>
          <button class="btn green" id="savePrefsBtn">Save Preferences</button>
        </div>

        <div class="col-6 card">
          <h2>Deliverables Checklist</h2>
          <div class="subtitle" style="margin-bottom:10px">Manage default quote deliverables.</div>
          <div id="set-deliverablesList"></div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <input id="set-newDel" placeholder="e.g. WhatsApp Setup">
            <button class="btn primary" id="addDelBtn">Add</button>
          </div>
        </div>

        <div id="settings-ai-container" class="col-12 card"></div>
      </div>
    `;

    const s = window.AppState.settings;
  
    // Bind current settings
    ['agencyName', 'logoUrl', 'upiQrUrl', 'taxRate', 'metaRate', 'currency', 'invoicePrefix'].forEach(id => {
        const el = document.getElementById('set-' + id);
        if(el) el.value = s[id] !== undefined ? s[id] : '';
    });

    document.getElementById('set-darkMode').checked = !!s.darkMode;
    document.getElementById('set-pinEnabled').checked = !!s.pinEnabled;

    const renderDeliverables = () => {
        document.getElementById('set-deliverablesList').innerHTML = (s.deliverables || []).map((d, i) => `
            <div style="display:flex; gap:8px; margin-bottom:8px">
                <input value="${escapeHTML(d)}" data-del-idx="${i}" style="padding:6px">
                <button class="btn danger small" data-del-rm="${i}">X</button>
            </div>
        `).join('');
    };
    renderDeliverables();

    // Handlers
    document.getElementById('saveProfileBtn').onclick = async () => {
        s.agencyName = document.getElementById('set-agencyName').value.trim();
        s.logoUrl = document.getElementById('set-logoUrl').value.trim();
        s.upiQrUrl = document.getElementById('set-upiQrUrl').value.trim();
        await window.AppState.saveSettings();
        alert("Profile saved.");
    };

    document.getElementById('savePricingBtn').onclick = async () => {
        s.taxRate = Number(document.getElementById('set-taxRate').value) || 0;
        s.metaRate = Number(document.getElementById('set-metaRate').value) || 0;
        s.currency = document.getElementById('set-currency').value;
        s.invoicePrefix = document.getElementById('set-invoicePrefix').value.trim() || 'INV';
        await window.AppState.saveSettings();
        alert("Pricing defaults saved.");
    };

    document.getElementById('savePrefsBtn').onclick = async () => {
        s.darkMode = document.getElementById('set-darkMode').checked;
        s.pinEnabled = document.getElementById('set-pinEnabled').checked;
        const pin = document.getElementById('set-appPin').value.trim();
        if (pin && /^\d{4}$/.test(pin)) {
            s.pin = pin;
            document.getElementById('set-appPin').value = ""; // clear after save
        } else if (pin) {
            alert("PIN must be exactly 4 digits.");
            return;
        }
        await window.AppState.saveSettings();
        alert("Preferences saved.");
    };

    document.getElementById('addDelBtn').onclick = async () => {
        const input = document.getElementById('set-newDel');
        const v = input.value.trim();
        if (v && !s.deliverables.includes(v)) {
            s.deliverables.push(v);
            input.value = "";
            await window.AppState.saveSettings();
            renderDeliverables();
        }
    };

    document.getElementById('set-deliverablesList').addEventListener('change', async (e) => {
        if (e.target.dataset.delIdx !== undefined) {
            s.deliverables[Number(e.target.dataset.delIdx)] = e.target.value.trim();
            await window.AppState.saveSettings();
        }
    });

    document.getElementById('set-deliverablesList').addEventListener('click', async (e) => {
        if (e.target.dataset.delRm !== undefined) {
            s.deliverables.splice(Number(e.target.dataset.delRm), 1);
            await window.AppState.saveSettings();
            renderDeliverables();
        }
    });
    if(window.renderAiConnector) window.renderAiConnector();
});

window.appRouter.addRoute('data', async () => {
 const container = document.getElementById('page-data');
    if(!container) {
        const main = document.querySelector('main');
        const p = document.createElement('section');
        p.id = 'page-data'; p.className = 'page';
        main.appendChild(p);
    }

    document.getElementById('page-data').innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Data Management (Backup / Restore)</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            </div>
            <p class="muted">Your data is stored completely offline on this device. Back it up regularly.</p>

            <div style="display:flex; gap:10px; margin-top:20px; flex-wrap:wrap">
                <button class="btn primary" id="exportJsonBtn">Export Full JSON Backup</button>
                <label class="btn" style="display:inline-block; margin:0">
                    Import JSON Backup
                    <input type="file" id="importJsonFile" accept=".json" hidden>
                </label>
            </div>

            <div id="dataStatus" role="status" aria-live="polite" style="display:none; margin-top:15px; padding:10px 12px; border-radius:10px; font-size:13px; font-weight:600; white-space:pre-wrap; word-break:break-word"></div>

            <h3 style="margin-top:30px; border-top:1px solid var(--line); padding-top:15px">Export CSV Data</h3>
            <div style="display:flex; gap:10px; flex-wrap:wrap">
                <button class="btn small" data-csv="clients">Clients</button>
                <button class="btn small" data-csv="quotes">Quotes</button>
                <button class="btn small" data-csv="invoices">Invoices</button>
                <button class="btn small" data-csv="expenses">Expenses</button>
                <button class="btn small" data-csv="projects">Projects</button>
                <button class="btn small" data-csv="payments">Payments</button>
            </div>

            <div class="danger-zone" style="margin-top:40px; padding:20px; border-radius:12px; background:var(--red-soft);">
                <h3 style="margin:0; color:var(--red)">Danger Zone</h3>
                <p style="font-size:12px; color:var(--red)">Permanently delete all data and reset the application.</p>
                <button class="btn danger" id="resetAppBtn">Factory Reset App</button>
            </div>
        </div>
    `;

    // Inline, honest status line for backup / restore / CSV results
    const STATUS_STYLES = {
        info:    ['var(--bg)', 'var(--text)'],
        success: ['var(--green-soft)', 'var(--green)'],
        warn:    ['var(--orange-soft)', 'var(--orange)'],
        error:   ['var(--red-soft)', 'var(--red)']
    };
    function setDataStatus(kind, message) {
        const el = document.getElementById('dataStatus');
        if (!el) return;
        const style = STATUS_STYLES[kind] || STATUS_STYLES.info;
        el.style.display = 'block';
        el.style.background = style[0];
        el.style.color = style[1];
        el.dataset.kind = kind;
        el.textContent = message;
    }

    // What saveFileToDevice() reports. Today it returns nothing, so we must NOT claim the file was saved.
    function describeSaveOutcome(outcome, filename, detail) {
        const st = outcome && typeof outcome === 'object' ? outcome.status : undefined;
        if (st === 'cancelled') {
            return ['warn', 'Save cancelled — no file was saved.'];
        }
        if (st === 'saved') {
            return ['success', '"' + filename + '" was saved. ' + detail];
        }
        return ['info', '"' + filename + '" was created and sent to your browser\'s save/download. ' + detail +
            '\nThe browser did not confirm the save — if no save dialog or download notification appeared, check your Downloads folder.'];
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
            reader.readAsText(file);
        });
    }

    function describeCounts(counts) { 
      const parts = Object.keys(counts).filter(k => k !== 'settings' && counts[k] > 0).map(k => k + ': ' + counts[k]);
        return parts.length ? parts.join(', ') : 'no business records';
    }

    let dataBusy = false;

    // Full JSON Backup
    document.getElementById('exportJsonBtn').onclick = async () => {
        if (dataBusy) return;
        dataBusy = true;
        try {
            setDataStatus('info', 'Preparing backup…');
            const all = await BackupTools.readAllStores();          // every store, one consistent read
            const backup = BackupTools.buildBackupObject(all);       // throws if any store is missing
            const check = BackupTools.validateBackup(backup);        // the file must be restorable
            if (!check.ok) throw new Error('Backup integrity check failed: ' + check.errors[0]);

            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
            const filename = `AutomationManager_Backup_${getTodayDate()}.json`;
            const detail = 'Records — ' + describeCounts(check.counts) + '. API keys and PIN are NOT included in the file.';
            const outcome = await saveFileToDevice(blob, filename);
            const shown = describeSaveOutcome(outcome, filename, detail);
            setDataStatus(shown[0], shown[1]);
        } catch (err) {
            console.error('Backup failed:', err);
            setDataStatus('error', 'Backup FAILED: ' + (err && err.message ? err.message : err) + '\nNo backup file was created.');
        } finally {
            dataBusy = false;
        }
    };

    // Safe JSON Restore: validate everything first, then replace all stores in one transaction
    document.getElementById('importJsonFile').onchange = async (e) => {
        const input = e.target;
        const file = input.files && input.files[0];
        if (!file) return;
        if (dataBusy) { input.value = ''; return; }
        dataBusy = true;
        let committed = false;
        try {
            setDataStatus('info', 'Checking "' + file.name + '"…');
            const text = await readFileAsText(file);
            const parsed = BackupTools.parseBackupText(text);
            if (!parsed.ok) {
                setDataStatus('error', 'Restore cancelled — this is not a valid backup.\n' + BackupTools.summarizeErrors(parsed.errors) + '\nYour existing data was NOT changed.');
                return;
            }

            const exported = parsed.meta && parsed.meta.exportedAt ? parsed.meta.exportedAt : 'unknown (older backup format)';
            let msg = 'Restore this backup?\n\nFile: ' + file.name + '\nExported: ' + exported + '\nContains: ' + describeCounts(parsed.counts) +
                '\n\nThis will REPLACE all current business data on this device and cannot be undone. API keys and PIN saved on this device are kept.';
            if (parsed.warnings.length) msg += '\n\nNote: ' + parsed.warnings.join(' ');
            if (!confirm(msg)) {
                setDataStatus('info', 'Restore cancelled. Your existing data was NOT changed.');
                return;
            }

            let restoreCredentials = false;
            if (BackupTools.settingsHaveCredentials(parsed.backup.settings[0])) {
                restoreCredentials = confirm('This backup file contains saved API keys and/or a PIN (older backup format).\n\nOK = restore them from the file.\nCancel = keep the API keys and PIN already saved on this device (recommended).');
            }

            setDataStatus('info', 'Restoring… please do not close the app.');
            await BackupTools.replaceAllStores(parsed.backup, { restoreCredentials: restoreCredentials });
            committed = true;
            alert('Restore complete (' + describeCounts(parsed.counts) + '). The app will now reload.');
            window.location.reload();
        } catch (err) {
            console.error('Restore failed:', err);
            const reason = err && err.message ? err.message : String(err);
            if (committed) {
                setDataStatus('warn', 'The restore completed, but the app could not reload automatically (' + reason + '). Please reload the page.');
            } else {
                setDataStatus('error', 'Restore FAILED: ' + reason + '\nYour existing data was NOT changed.');
            }
        } finally {
            dataBusy = false;
            input.value = ''; // allow selecting the same file again
        }
    };

    // CSV Exports
  document.getElementById('page-data').onclick = async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-csv]') : null;
        if (!btn) return;
        const type = btn.dataset.csv;
        const label = BackupTools.CSV_LABELS[type];
        if (!label || dataBusy) return;
        dataBusy = true;
        try {
            const data = await window.appDB.getAll(type);
            if (data.length === 0) {
                setDataStatus('info', BackupTools.emptyCsvMessage(type));
                return;
            }
            const csv = BackupTools.buildCsv(data);
            const blob = new Blob([csv.text], { type: "text/csv" });
            const filename = `Automation_${type}_${getTodayDate()}.csv`;
            const outcome = await saveFileToDevice(blob, filename);
            const shown = describeSaveOutcome(outcome, filename, label + ': ' + csv.rowCount + ' record(s), ' + csv.headers.length + ' column(s).');
            setDataStatus(shown[0], shown[1]);
        } catch (err) {
            console.error('CSV export failed:', err);
            setDataStatus('error', label + ' export FAILED: ' + (err && err.message ? err.message : err) + '\nNo file was created.');
        } finally {
            dataBusy = false;
        }
    };

    // Reset App
    document.getElementById('resetAppBtn').onclick = async () => {
        const pin = prompt("WARNING: This will delete ALL data. Type 'DELETE' to confirm:");
        if (pin === 'DELETE') {
            const stores = ['settings', 'clients', 'services', 'quotes', 'projects', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'notes', 'activity'];
            for(let s of stores) {
                try { await window.appDB.clear(s); } catch(e){}
            }
            localStorage.removeItem('automation_pricing_app_v1'); // wipe old data too
            alert("Application reset. Reloading.");
            window.location.reload();
        }
    };
});

// AI Connector Setup Logic
window.renderAiConnector = () => {
    const container = document.getElementById('settings-ai-container');
    if (!container) return;

    container.innerHTML = `
        <h2>AI & Integrations</h2>
        <div class="subtitle" style="margin-bottom:15px">Configure AI models to connect your Automation Manager.</div>

        <div class="field">
            <label>AI Provider</label>
            <select id="set-aiProvider">
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
            </select>
        </div>

        <div id="ai-openai-fields" style="display:none">
            <div class="field">
                <label>OpenAI API Key</label>
                <input type="password" id="set-aiApiKeyOpenAI" placeholder="sk-...">
            </div>
            <div class="field">
                <label>OpenAI Model</label>
                <input id="set-aiModelOpenAI" placeholder="gpt-4o-mini" value="gpt-4o-mini">
            </div>
        </div>

        <div id="ai-gemini-fields" style="display:none">
            <div class="field">
                <label>Gemini API Key</label>
                <input type="password" id="set-aiApiKeyGemini" placeholder="AIza...">
            </div>
            <div class="field">
                <label>Gemini Model</label>
                <input id="set-aiModelGemini" placeholder="gemini-3.8-flash" value="gemini-3.8-flash">
            </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:15px;">
            <button class="btn primary" id="saveAiBtn">Save Credentials</button>
            <button class="btn" id="testAiBtn">Test Connection</button>
        </div>

        <div id="aiTestResult" style="margin-top:15px; font-weight:bold; font-size:14px; padding: 10px; border-radius: 8px; display: none;"></div>
    `;

    const s = window.AppState.settings;

    // Bind initial values
  document.getElementById('set-aiProvider').value = s.aiProvider || 'openai';
    document.getElementById('set-aiApiKeyOpenAI').value = s.aiApiKeyOpenAI || '';
    document.getElementById('set-aiModelOpenAI').value = s.aiModelOpenAI || 'gpt-4o-mini';
    document.getElementById('set-aiApiKeyGemini').value = s.aiApiKeyGemini || '';
    document.getElementById('set-aiModelGemini').value = s.aiModelGemini || 'gemini-3.8-flash';

    const toggleFields = () => {
        const prov = document.getElementById('set-aiProvider').value;
        document.getElementById('ai-openai-fields').style.display = prov === 'openai' ? 'block' : 'none';
        document.getElementById('ai-gemini-fields').style.display = prov === 'gemini' ? 'block' : 'none';
    };
    toggleFields();

    document.getElementById('set-aiProvider').addEventListener('change', toggleFields);

    document.getElementById('saveAiBtn').onclick = async () => {
        s.aiProvider = document.getElementById('set-aiProvider').value;
        s.aiApiKeyOpenAI = document.getElementById('set-aiApiKeyOpenAI').value.trim();
        s.aiModelOpenAI = document.getElementById('set-aiModelOpenAI').value.trim() || 'gpt-4o-mini';
        s.aiApiKeyGemini = document.getElementById('set-aiApiKeyGemini').value.trim();
        s.aiModelGemini = document.getElementById('set-aiModelGemini').value.trim() || 'gemini-3.8-flash';

        await window.AppState.saveSettings();
        alert("AI Credentials saved.");
    };

    document.getElementById('testAiBtn').onclick = async () => {
        const prov = document.getElementById('set-aiProvider').value;
        const resEl = document.getElementById('aiTestResult');
        resEl.style.display = 'block';
        resEl.textContent = 'Testing connection...';
        resEl.style.backgroundColor = 'var(--bg)';
        resEl.style.color = 'var(--text)';

        const startTime = Date.now();

        try {
            if (prov === 'openai') {
                const key = document.getElementById('set-aiApiKeyOpenAI').value.trim();
                const model = document.getElementById('set-aiModelOpenAI').value.trim() || 'gpt-4o-mini';
                if (!key) throw new Error("Please enter an OpenAI API key first.");

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: 'Reply with exactly: Connection successful.' }],
                        max_tokens: 10
                    })
                });

                if (!response.ok) {
                    const errBody = await response.json().catch(()=>({}));
                    throw new Error(`OpenAI Error: ${response.status} ${errBody.error?.message || response.statusText}`);
                }

                const data = await response.json();
                const msg = data.choices?.[0]?.message?.content?.trim();
                if (msg) {
                    const elapsed = Date.now() - startTime;
                    resEl.textContent = `✅ Connected. Response: "${msg}" (${elapsed}ms)`;
                    resEl.style.backgroundColor = 'var(--green-soft)';
                    resEl.style.color = 'var(--green)';
                } else {
                    throw new Error("Invalid response format from OpenAI.");
                }

            } else if (prov === 'gemini') {
                const key = document.getElementById('set-aiApiKeyGemini').value.trim();
                const model = document.getElementById('set-aiModelGemini').value.trim() || 'gemini-3.8-flash';
                if (!key) throw new Error("Please enter a Gemini API key first.");

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Reply with exactly: Connection successful.' }] }]
                    })
                });

                if (!response.ok) {
                  const errBody = await response.json().catch(()=>({}));

                    if (response.status === 429) {
                        let retryMsg = "Gemini API quota/rate limit exceeded. Please check your Google AI Studio/API project quota or billing, then try again.";
                        const retryAfter = response.headers.get('Retry-After');
                        if (retryAfter) {
                            const seconds = parseInt(retryAfter, 10);
                            if (!isNaN(seconds)) {
                                if (seconds > 60) {
                                    retryMsg += ` Please try again in about ${Math.ceil(seconds/60)} minutes.`;
                                } else {
                                    retryMsg += ` Please try again in about ${seconds} seconds.`;
                                }
                            }
                        }
                        const err = new Error(retryMsg);
                        err.type = 'QUOTA';
                        throw err;
                    } else if (response.status === 401 || response.status === 403) {
                        const err = new Error("Authentication failed. Please check your Gemini API key and permissions.");
                        err.type = 'AUTH';
                        throw err;
                    } else if (response.status === 404) {
                        const err = new Error("Model or endpoint not found. Please verify your Gemini model name.");
                        err.type = 'CONFIG';
                        throw err;
                    }

                    throw new Error(`Gemini Error: ${response.status} ${errBody.error?.message || response.statusText}`);
                }

                const data = await response.json();
                const msg = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (msg) {
                    const elapsed = Date.now() - startTime;
                    resEl.textContent = `✅ Connected. Response: "${msg}" (${elapsed}ms)`;
                    resEl.style.backgroundColor = 'var(--green-soft)';
                    resEl.style.color = 'var(--green)';
                } else {
                    throw new Error("Invalid response format from Gemini.");
                }
            }
        } catch (err) {
            const elapsed = Date.now() - startTime;
            let statusStr = "Connection failed";

            // Check specific types from our manual throws
            if (err.type === 'QUOTA') {
                statusStr = "Quota exceeded";
            } else if (err.type === 'AUTH') {
                statusStr = "Authentication failed";
            } else if (err.type === 'CONFIG') {
                statusStr = "Configuration error";
            } else if (err.message.includes("fetch") || err.message.includes("NetworkError") || err.message.includes("Failed to fetch")) {
                statusStr = "Network error";
            }

            resEl.textContent = `❌ ${statusStr}: ${err.message} (${elapsed}ms)`;
            resEl.style.backgroundColor = 'var(--red-soft)';
            resEl.style.color = 'var(--red)';
        }
    };
};
                  
