class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;

        // Listen to navigation clicks
        document.addEventListener('click', (e) => {
            const navBtn = e.target.closest('[data-navigate]');
            if (navBtn) {
                e.preventDefault();
                this.navigate(navBtn.dataset.navigate);
            }
        });

        // More Menu Toggle
        document.addEventListener('click', (e) => {
            const moreToggle = e.target.closest('#moreMenuToggle');
            if (moreToggle) {
                document.getElementById('moreMenuDrawer').classList.toggle('active');
            } else if (!e.target.closest('#moreMenuDrawer')) {
                const drawer = document.getElementById('moreMenuDrawer');
                if (drawer) drawer.classList.remove('active');
            }
        });
    }

    addRoute(name, renderFunction) {
        this.routes[name] = renderFunction;
    }

    async navigate(name) {
        if (!this.routes[name]) {
            console.error(`Route ${name} not found`);
            return;
        }

        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        // Show target page
        const targetPage = document.getElementById(`page-${name}`);
        if (!targetPage) {
             // Create page container if it doesn't exist
             const main = document.querySelector('main');
             const newPage = document.createElement('section');
             newPage.id = `page-${name}`;
             newPage.className = 'page active';
             main.appendChild(newPage);
        } else {
             targetPage.classList.add('active');
        }

        // Update active state on nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.navigate === name);
        });

        // Close drawer if open
        const drawer = document.getElementById('moreMenuDrawer');
        if (drawer) drawer.classList.remove('active');

        // Execute render function
        this.currentRoute = name;
        await this.routes[name]();
    }
}

window.appRouter = new Router();