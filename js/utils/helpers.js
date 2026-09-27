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

// True for a real, valid Date object.
function isValidDateObject(value) {
    return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

// Formats a Date as YYYY-MM-DD using local calendar date.
function formatLocalDate(date) {
    if (!isValidDateObject(date)) return '';
    const y = String(date.getFullYear()).padStart(4, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Today's date (YYYY-MM-DD) on local device clock.
function getTodayDate() {
    return formatLocalDate(new Date());
}

// Date ranges for global filter presets
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

// Default application settings
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
        defaultQuoteValidity: 30,
        defaultTerms: "Payment is due upon receipt. Work begins after initial deposit.",
        footerText: "Thank you for your business!",
        deliverables: ["WhatsApp Setup","Facebook Ads","Automation Setup"],
        themeMode: "system",
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

function mergeSettingsWithDefaults(stored) {
    const defaults = getDefaultSettings();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;

    const merged = Object.assign({}, stored);
    Object.keys(defaults).forEach(key => {
        const value = stored[key];
        if (value === undefined || value === null) {
            merged[key] = defaults[key];
        } else if (Array.isArray(defaults[key]) && !Array.isArray(value)) {
            merged[key] = defaults[key];
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
            this.settings = getDefaultSettings();
            await window.appDB.put('settings', this.settings);
        } else {
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
        if (!itemDateStr) itemDateStr = item.created;
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

// Download Helper
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
                return { status: 'cancelled', method: 'picker' };
            }
            console.error('File System Access API failed, falling back:', err);
        }
    }

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
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

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

        confirmBtn.focus();

        const cleanup = () => {
            if (overlay.parentNode) document.body.removeChild(overlay);
            document.removeEventListener('keydown', keydownHandler);
        };

        const handleResult = (result) => {
            cleanup();
            resolve(result);
        };

        cancelBtn.onclick = () => handleResult(false);
        confirmBtn.onclick = () => handleResult(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) handleResult(false);
        };

        const keydownHandler = (e) => {
            if (e.key === 'Escape') handleResult(false);
            else if (e.key === 'Enter') {
                if (document.activeElement !== cancelBtn && document.activeElement !== confirmBtn) {
                    handleResult(true);
                }
            }
        };
        document.addEventListener('keydown', keydownHandler);
    });
};

// Discard Unsaved Changes Confirm
window.showDiscardConfirm = function() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

        const modal = document.createElement('div');
        modal.className = 'confirm-box card';

        const msgEl = document.createElement('p');
        msgEl.className = 'confirm-message';
        msgEl.textContent = 'Discard unsaved changes?';

        const btnContainer = document.createElement('div');
        btnContainer.className = 'confirm-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'Cancel';

        const discardBtn = document.createElement('button');
        discardBtn.className = 'btn danger';
        discardBtn.textContent = 'Discard';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(discardBtn);
        modal.appendChild(msgEl);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        discardBtn.focus();

        const cleanup = () => {
            if (overlay.parentNode) document.body.removeChild(overlay);
            document.removeEventListener('keydown', keydownHandler);
        };

        const handleResult = (result) => {
            cleanup();
            resolve(result);
        };

        cancelBtn.onclick = () => handleResult(false);
        discardBtn.onclick = () => handleResult(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) handleResult(false);
        };

        const keydownHandler = (e) => {
            if (e.key === 'Escape') handleResult(false);
        };
        document.addEventListener('keydown', keydownHandler);
    });
};

// Toast Notifications
window.showToast = function(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.2s ease';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 200);
    }, 2800);
};