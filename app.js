// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered', reg))
            .catch(err => console.log('SW Registration Failed', err));
    });
}

// App Initialization
async function initApp() {
    try {
        // Initialize DB
        await window.appDB.getAll('settings'); // Just to ensure DB is created

        // Handle Migration
        await runMigrationIfNeeded();

        // Load Global State
        await window.AppState.loadSettings();

        // Setup Lock Screen if needed
        setupLockScreen();

        // Check if locked
        if (window.AppState.settings.pinEnabled && /^\d{4}$/.test(window.AppState.settings.pin)) {
             document.getElementById('lockScreen').style.display = 'grid';
        } else {
             // Navigate to Dashboard
             window.appRouter.navigate('dashboard');
        }

    } catch (e) {
        console.error("Failed to initialize app:", e);
        alert("Failed to initialize database. If you are in private mode, IndexedDB might be blocked.");
    }
}

// Lock screen logic
function setupLockScreen() {
    const pinPad = document.getElementById("pinPad");
    if(!pinPad) return;

    let pinInput = "";
    const dots = document.getElementById("pinDots");

    dots.innerHTML = [0,1,2,3].map(i => `<span class="pin-dot" id="dot${i}"></span>`).join("");
    pinPad.innerHTML = [1,2,3,4,5,6,7,8,9,"⌫",0].map(k => `<button class="pin-key" data-pin="${k}">${k}</button>`).join("");

    pinPad.querySelectorAll("[data-pin]").forEach(b => b.onclick = () => {
      const k = b.dataset.pin;
      if(k === "⌫") pinInput = pinInput.slice(0,-1);
      else if(pinInput.length < 4) pinInput += k;

      [0,1,2,3].forEach(i => document.getElementById("dot"+i).classList.toggle("filled", i < pinInput.length));

      if(pinInput.length === 4){
        if(pinInput === window.AppState.settings.pin){
            document.getElementById("lockScreen").style.display = "none";
            pinInput = "";
            window.appRouter.navigate('dashboard');
        } else {
            document.getElementById("pinError").textContent = "Incorrect PIN";
            pinInput = "";
            setTimeout(() => {
                document.getElementById("pinError").textContent = "";
                [0,1,2,3].forEach(i => document.getElementById("dot"+i).classList.remove("filled"));
            }, 900);
        }
      }
    });
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);

// Top Bar Filter Toggle
document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.global-filter-btn');
    if (filterBtn) {
        document.getElementById('filterMenuDrawer').classList.toggle('active');

        // Populate inputs from state
        document.getElementById('filterFromDate').value = window.AppFilter.fromDate;
        document.getElementById('filterToDate').value = window.AppFilter.toDate;
        document.getElementById('filterFromTime').value = window.AppFilter.fromTime;
        document.getElementById('filterToTime').value = window.AppFilter.toTime;
        document.getElementById('filterPreset').value = window.AppFilter.preset;
    }
});

// Filter Presets Logic
document.addEventListener('change', (e) => {
    if (e.target.id === 'filterPreset') {
        const fromDateEl = document.getElementById('filterFromDate');
        const toDateEl = document.getElementById('filterToDate');

        // Local calendar dates (see getDatePresetRange in helpers.js): never UTC, so "This month"
        // starts on the 1st for users east of UTC (e.g. India) instead of the last day of the previous month.
        const range = getDatePresetRange(e.target.value);
        if (range) {
            fromDateEl.value = range.from;
            toDateEl.value = range.to;
        }
        // custom - don't overwrite user changes
    }
});

// Apply / Clear Filter Logic
document.addEventListener('click', (e) => {
    if (e.target.id === 'applyFilterBtn') {
        const fromDate = document.getElementById('filterFromDate').value;
        const toDate = document.getElementById('filterToDate').value;
        const fromTime = document.getElementById('filterFromTime').value;
        const toTime = document.getElementById('filterToTime').value;
        const preset = document.getElementById('filterPreset').value;

        window.AppFilter.apply(fromDate, toDate, fromTime, toTime, preset);
        document.getElementById('filterMenuDrawer').classList.remove('active');

        // Re-render current route
        if (window.appRouter && window.appRouter.currentRoute) {
            window.appRouter.navigate(window.appRouter.currentRoute);
        }
    } else if (e.target.id === 'clearFilterBtn') {
        window.AppFilter.clear();
        document.getElementById('filterMenuDrawer').classList.remove('active');

        // Re-render current route
        if (window.appRouter && window.appRouter.currentRoute) {
            window.appRouter.navigate(window.appRouter.currentRoute);
        }
    }
});

// Theme toggle override to use settings
document.addEventListener('click', async (e) => {
    const themeBtn = e.target.closest('#themeBtn');
    if (themeBtn) {
        // Simple toggle just flips light/dark, and unsets system
        const currentIsDark = document.documentElement.dataset.theme === 'dark';
        window.AppState.settings.themeMode = currentIsDark ? 'light' : 'dark';
        await window.AppState.saveSettings();
    }
});


// Update filter button state whenever route changes
const originalNavigate = window.appRouter.navigate;
window.appRouter.navigate = async function(name) {
    await originalNavigate.call(this, name);
    document.querySelectorAll('.global-filter-btn').forEach(btn => {
        if (window.AppFilter.active) {
            btn.classList.add('active-filter');
        } else {
            btn.classList.remove('active-filter');
        }
    });
};
