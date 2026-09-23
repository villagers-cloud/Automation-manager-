// Generate random ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Format money based on currency setting
function formatMoney(amount, currency = '₹') {
    return `${currency}${Number(amount || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

// Escape HTML to prevent XSS
function escapeHTML(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
}

// True for a real, valid Date object. Uses the internal class tag instead of `instanceof`,
// which is unreliable across realms (iframes) and with subclassed/mocked Date constructors.
function isValidDateObject(value) {
    return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

// Formats a Date as YYYY-MM-DD using the device's LOCAL calendar date.
// (toISOString() is UTC: for a user in India, before 05:30 it returns YESTERDAY's date.)
function formatLocalDate(date) {
    if (!isValidDateObject(date)) return '';
    const y = String(date.getFullYear()).padStart(4, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Today's date (YYYY-MM-DD) on the user's device clock, in the user's timezone.
function getTodayDate() {
    return formatLocalDate(new Date());
}

// Date ranges for the global filter presets, as { from, to } (YYYY-MM-DD, local calendar dates).
// Returns null for 'custom' / unknown presets (the user's own dates must not be overwritten).
// Weeks start on Sunday. The calendar arithmetic is done on plain year/month/day numbers
// (in UTC space) so it can never be shifted by the timezone or by daylight-saving changes.
function getDatePresetRange(preset, now) {
    const ref = isValidDateObject(now) ? now : new Date();
    const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate(), dow = ref.getDay();
    const DAY = 86400000;
    const fmt = (ms) => {
        const x = new Date(ms);
        return `${String(x.getUTCFullYear()).padStart(4, '0')}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
    };
    const today = Date.UTC(y, m, d);

    switch (preset) {
        case 'today':      return { from: fmt(today), to: fmt(today) };
        case 'yesterday':  return { from: fmt(today - DAY), to: fmt(today - DAY) };
        case 'this_week':  return { from: fmt(today - dow * DAY), to: fmt(today) };
        case 'last_week':  return { from: fmt(today - (dow + 7) * DAY), to: fmt(today - (dow + 1) * DAY) };
        case 'this_month': return { from: fmt(Date.UTC(y, m, 1)), to: fmt(today) };
        case 'last_month': return { from: fmt(Date.UTC(y, m - 1, 1)), to: fmt(Date.UTC(y, m, 0)) };
        case 'this_year':  return { from: fmt(Date.UTC(y, 0, 1)), to: fmt(today) };
        case 'last_year':  return { from: fmt(Date.UTC(y - 1, 0, 1)), to: fmt(Date.UTC(y - 1, 11, 31)) };
        default:           return null;
    }
}

// Default application settings. Returns a FRESH object every time, so callers can never
// mutate a shared default (for example by pushing into `deliverables`).
function getDefaultSettings() {
    return {
        id: 'appSettings',
        agencyName: "Your Agency",
        logoUrl: "",
        upiQrUrl: "",
        phone: "",
        email: "",
        website: "",
        address: "",
        taxRate: 18,
        metaRate: 0.85,
        currency: "₹",
        gstNumber: "",
        taxSettings: "inclusive",
        invoicePrefix: "INV",
        quotePrefix: "QT",
        defaultQuoteValidity: 30, // days
        defaultTerms: "Payment is due upon receipt. Work begins after initial deposit.",
        footerText: "Thank you for your business!",
        deliverables: ["WhatsApp Setup","Facebook Ads","Automation Setup"],
        themeMode: "system", // light, dark, system
        pinEnabled: false,
        pin: "",
        dateFormat: "YYYY-MM-DD",
        timeFormat: "24h",
        aiProvider: "openai",
        aiApiKeyOpenAI: "",
        aiModelOpenAI: "gpt-4o-mini",
        aiApiKeyGemini: "",
        aiModelGemini: "gemini-3.8-flash"
    };
}

// Fills every setting that is missing (undefined / null) with its default, WITHOUT changing
// anything the user has stored: real values always win, including 0, "" and false.
// Extra stored keys (migrated_v1, darkMode, ...) are kept. Used for records that come from
// a migration, a restored backup, or an older version of the app and lack newer fields.
function mergeSettingsWithDefaults(stored) {
    const defaults = getDefaultSettings();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;

    const merged = Object.assign({}, stored);
    Object.keys(defaults).forEach(key => {
        const value = stored[key];
        if (value === undefined || value === null) {
            merged[key] = defaults[key];
        } else if (Array.isArray(defaults[key]) && !Array.isArray(value)) {
            merged[key] = defaults[key]; // a non-list here would crash the UI (.map / .includes)
        }
    });
    merged.id = 'appSettings';
    return merged;
}

// Global App State
window.AppState = {
    settings: null,
    async loadSettings() {
        const stored = await window.appDB.get('settings', 'appSettings');
        if (!stored) {
            // First run: create and save the default settings
            this.settings = getDefaultSettings();
            await window.appDB.put('settings', this.settings);
        } else {
            // Existing record (may come from a migration / restored backup / older version and lack newer fields):
            // fill the gaps in memory only. Nothing is written until the user saves settings.
            this.settings = mergeSettingsWithDefaults(stored);
        }
        this.applyTheme();
    },
    async saveSettings() {
        await window.appDB.put('settings', this.settings);
        this.applyTheme();
    },
    applyTheme() {
        let mode = this.settings.themeMode || "system";
        let isDark = false;

        if (mode === "system") {
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

            // Listen for system theme changes if not already set up
            if (!this._themeListenerSetup) {
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                    if (this.settings.themeMode === "system") {
                        document.documentElement.dataset.theme = e.matches ? "dark" : "light";
                        this.updateThemeButton(e.matches);
                    }
                });
                this._themeListenerSetup = true;
            }
        } else {
            isDark = mode === "dark";
        }

        document.documentElement.dataset.theme = isDark ? "dark" : "light";
        this.updateThemeButton(isDark);
    },
    updateThemeButton(isDark) {
        const themeBtn = document.getElementById("themeBtn");
        if(themeBtn) themeBtn.textContent = isDark ? "☀" : "☾";
    }
};

// Global Filter State
window.AppFilter = {
    active: false,
    fromDate: "",
    toDate: "",
    fromTime: "",
    toTime: "",
    preset: "custom",

    apply(fromDate, toDate, fromTime, toTime, preset) {
        this.fromDate = fromDate;
        this.toDate = toDate;
        this.fromTime = fromTime;
        this.toTime = toTime;
        this.preset = preset;
        this.active = !!(fromDate || toDate);
    },

    clear() {
        this.active = false;
        this.fromDate = "";
        this.toDate = "";
        this.fromTime = "";
        this.toTime = "";
        this.preset = "custom";
    }
};

// Date Filter Data Helper
function filterDataByDate(data, dateField = 'date') {
    if (!window.AppFilter.active) return data;

    const filterFrom = window.AppFilter.fromDate ? new Date(`${window.AppFilter.fromDate}T${window.AppFilter.fromTime || '00:00:00'}`) : null;
    const filterTo = window.AppFilter.toDate ? new Date(`${window.AppFilter.toDate}T${window.AppFilter.toTime || '23:59:59'}`) : null;

    return data.filter(item => {
        let itemDateStr = item[dateField];
        if (!itemDateStr) itemDateStr = item.created; // Fallback
        if (!itemDateStr) return true;

        let parseStr = itemDateStr;
        if (typeof parseStr === 'string' && parseStr.length === 10 && parseStr.includes('-')) {
            parseStr += 'T00:00:00';
        }

        let itemDate = new Date(parseStr);
        if (isNaN(itemDate.getTime())) return true;

        if (filterFrom && itemDate < filterFrom) return false;
        if (filterTo && itemDate > filterTo) return false;

        return true;
    });
}

// Download Helper.
// Returns a plain result object describing what actually happened — never throws for an
// ordinary save/cancel, so a caller can show an honest message instead of always guessing:
//   { status: 'saved',      method: 'picker' }  - the browser confirmed the file was written
//   { status: 'cancelled',  method: 'picker' }  - the user closed the Save dialog; nothing was written
//   { status: 'downloaded', method: 'anchor'  }  - handed to the browser's normal download (mobile /
//                                                  unsupported browsers); the browser gives no confirmation,
//                                                  so this only means the download was *started*, not saved
// A genuine failure to hand off the file (both the picker AND the anchor fallback failed) still throws,
// so existing callers' try/catch (Backup/CSV export) keep showing their own "FAILED" message unchanged.
async function saveFileToDevice(blob, filename) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'File',
                    accept: { [blob.type]: ['.' + filename.split('.').pop()] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { status: 'saved', method: 'picker' };
        } catch (err) {
            if (err.name === 'AbortError') {
                return { status: 'cancelled', method: 'picker' }; // User cancelled — nothing was written, nothing to fall back to
            }
            console.error('File System Access API failed, falling back:', err);
            // fall through to the anchor-download fallback below
        }
    }

    // Fallback for mobile / browsers without File System Access API.
    // The object URL is kept alive for a short while after click(): on some mobile browsers and
    // WebViews the download is handled asynchronously, and revoking immediately can cut it off
    // before the browser has actually read the blob's data.
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return { status: 'downloaded', method: 'anchor' };
    } catch (err) {
        throw new Error('Could not start the download: ' + (err && err.message ? err.message : err));
    }
}

// Global Custom Confirm
window.showConfirm = function(message) {
    return new Promise((resolve) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

        // Create modal box
        const modal = document.createElement('div');
        modal.className = 'confirm-box card';

        const msgEl = document.createElement('p');
        msgEl.className = 'confirm-message';
        msgEl.textContent = message;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'confirm-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'Cancel';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn danger';
        confirmBtn.textContent = 'Confirm';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        modal.appendChild(msgEl);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Trap focus inside modal
        confirmBtn.focus();

        const cleanup = () => {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', keydownHandler);
        };

        const handleResult = (result) => {
            cleanup();
            resolve(result);
        };

        cancelBtn.onclick = () => handleResult(false);
        confirmBtn.onclick = () => handleResult(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                handleResult(false);
            }
        };

        const keydownHandler = (e) => {
            if (e.key === 'Escape') {
                handleResult(false);
            } else if (e.key === 'Enter') {
                // If focus is not already on a button, confirm
                if (document.activeElement !== cancelBtn && document.activeElement !== confirmBtn) {
                    handleResult(true);
                }
            }
        };
        document.addEventListener('keydown', keydownHandler);
    });
};
