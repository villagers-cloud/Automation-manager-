// Handle Migration from localStorage to IndexedDB
//
// Data-safety rules (Phase 1):
//  * The "migrated_v1" flag is written LAST, only after every client and quote was migrated.
//    If anything fails halfway, the flag is NOT set and the next start retries.
//  * The migration is idempotent: clients are matched by name (so a retry never creates
//    duplicates) and quotes that already exist are skipped (so a retry never overwrites edits).
//  * Existing settings are MERGED, never overwritten: whatever is already stored (AI keys,
//    themeMode, phone, address, ...) wins; legacy values only fill in missing fields.
//  * localStorage is never deleted here.
async function runMigrationIfNeeded() {
    const LOCAL_STORAGE_KEY = "automation_pricing_app_v1";
    const result = {
        status: 'skipped',
        reason: '',
        clientsCreated: 0,
        quotesCreated: 0,
        quotesSkippedExisting: 0,
        invalidSkipped: 0,
        error: null
    };
    const finish = (r) => {
        try { window.lastMigrationResult = r; } catch (ignore) { /* not critical */ }
        return r;
    };

    let oldData = null;
    try {
        oldData = localStorage.getItem(LOCAL_STORAGE_KEY);
    } catch (e) {
        result.reason = 'localstorage-unavailable';
        return finish(result);
    }
    if (!oldData) {
        result.reason = 'no-legacy-data'; // No old data to migrate
        return finish(result);
    }

    let parsed;
    try {
        parsed = JSON.parse(oldData);
    } catch (e) {
        console.error("Migration skipped: legacy data is not valid JSON.", e);
        result.status = 'failed';
        result.reason = 'invalid-legacy-data';
        result.error = String(e && e.message ? e.message : e);
        return finish(result);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error("Migration skipped: legacy data has an unexpected structure.");
        result.status = 'failed';
        result.reason = 'invalid-legacy-data';
        return finish(result);
    }

    // --- small helpers -------------------------------------------------------
    const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const nonEmptyString = (v) => (typeof v === 'string' && v.trim() !== '') ? v : undefined;
    const anyString = (v) => (typeof v === 'string') ? v : undefined;
    const finiteNumber = (v) => {
        if (typeof v === 'number') return isFinite(v) ? v : undefined;
        if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
        return undefined;
    };
    const normalizeName = (n) => String(n).trim().toLowerCase();
    // copy only defined values (an explicit `undefined` must not erase a fallback)
    const assignDefined = (target, source) => {
        Object.keys(source).forEach(k => { if (source[k] !== undefined) target[k] = source[k]; });
        return target;
    };
    const legacyQuoteId = (q, index) => {
        if (typeof q.id === 'string' && q.id.trim() !== '') return q.id;
        if (typeof q.id === 'number' && isFinite(q.id)) return String(q.id);
        return 'legacy-quote-' + (index + 1); // deterministic: a retry must find the same id
    };

    try {
        // Check if already migrated
        const existingSettings = await window.appDB.get('settings', 'appSettings');
        if (existingSettings && existingSettings.migrated_v1) {
            result.reason = 'already-migrated';
            return finish(result);
        }

        console.log("Migrating data from localStorage to IndexedDB...");

        // 1. Clients: reuse any client that already exists (same name) so a retry never duplicates
        const clientIdByName = new Map();
        const existingClients = await window.appDB.getAll('clients');
        for (const c of existingClients) {
            if (c && typeof c.name === 'string' && normalizeName(c.name) !== '') {
                const key = normalizeName(c.name);
                if (!clientIdByName.has(key)) clientIdByName.set(key, c.id);
            }
        }

        // 2. Quotes (the old app had no standalone Client entity, so clients are created from quote names)
        const legacyQuotes = Array.isArray(parsed.quotes) ? parsed.quotes : [];
        for (let i = 0; i < legacyQuotes.length; i++) {
            const q = legacyQuotes[i];
            if (!isRecord(q)) {
                result.invalidSkipped++;
                continue;
            }

            const quoteId = legacyQuoteId(q, i);
            if (await window.appDB.get('quotes', quoteId) !== undefined) {
                result.quotesSkippedExisting++; // already migrated / already present: never overwrite
                continue;
            }

            let clientId = null;
            const clientName = (q.clientName === undefined || q.clientName === null) ? '' : String(q.clientName);
            if (clientName.trim() !== '') {
                const key = normalizeName(clientName);
                if (clientIdByName.has(key)) {
                    clientId = clientIdByName.get(key);
                } else {
                    clientId = generateId();
                    await window.appDB.put('clients', {
                        id: clientId,
                        name: clientName,
                        dateAdded: new Date().toISOString()
                    });
                    clientIdByName.set(key, clientId);
                    result.clientsCreated++;
                }
            }

            const newQuote = {
                id: quoteId,
                invoice: q.invoice,
                clientId: clientId,
                clientNameTemp: q.clientName, // Store temp name just in case
                date: q.date,
                setupFee: Number(q.setupFee) || 0,
                retainer: Number(q.retainer) || 0,
                deliverables: Array.isArray(q.deliverables) ? q.deliverables : [],
                expenses: Array.isArray(q.expenses) ? q.expenses : [],
                dailyMessages: Number(q.dailyMessages) || 0,
                actualProfit: q.actualProfit,
                notes: q.notes,
                status: q.status || "Pending",
                created: new Date().toISOString()
            };
            await window.appDB.put('quotes', newQuote);
            result.quotesCreated++;
        }

        // 3. Settings: MERGE (lowest priority -> highest): fallbacks < legacy values < existing settings
        const ls = isRecord(parsed.settings) ? parsed.settings : {};
        const merged = {
            agencyName: "Your Agency",
            logoUrl: "",
            upiQrUrl: "",
            taxRate: 18,
            metaRate: 0.85,
            currency: "₹",
            invoicePrefix: "INV",
            deliverables: ["WhatsApp Setup", "Facebook Ads", "Automation Setup"],
            pinEnabled: false,
            pin: ""
        };
        assignDefined(merged, {
            agencyName: nonEmptyString(ls.agencyName),
            logoUrl: anyString(ls.logoUrl),
            upiQrUrl: anyString(ls.upiQrUrl),
            taxRate: finiteNumber(ls.taxRate),          // 0 is a valid tax rate
            metaRate: finiteNumber(ls.metaRate),
            currency: nonEmptyString(ls.currency),
            invoicePrefix: nonEmptyString(ls.invoicePrefix),
            deliverables: (Array.isArray(ls.deliverables) && ls.deliverables.length) ? ls.deliverables : undefined,
            pinEnabled: (ls.pinEnabled === undefined) ? undefined : !!ls.pinEnabled,
            pin: anyString(ls.pin)
        });
        // legacy dark-mode boolean -> the app's themeMode ('dark' / 'light'; never invented when unknown)
        if (typeof ls.darkMode === 'boolean') {
            merged.darkMode = ls.darkMode;
            merged.themeMode = ls.darkMode ? 'dark' : 'light';
        }
        if (isRecord(existingSettings)) assignDefined(merged, existingSettings); // existing values always win
        merged.id = 'appSettings';
        merged.migrated_v1 = true; // written LAST: only reached when every client and quote was migrated
        await window.appDB.put('settings', merged);

        console.log("Migration completed successfully.");
        // We DO NOT delete localStorage yet for safety.
        // The migrated_v1 flag in settings prevents re-migration.
        result.status = 'migrated';
        return finish(result);

    } catch (e) {
        // The flag was not written, so the next start retries (safely, see idempotency notes above).
        console.error("Migration failed (it will be retried on the next start):", e);
        result.status = 'failed';
        result.reason = 'write-error';
        result.error = String(e && e.message ? e.message : e);
        return finish(result);
    }
}
