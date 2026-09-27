class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;
        this.historyStack = [];
        this.isFormDirty = false;
        this.isNavigating = false;

        // Listen to navigation clicks
        document.addEventListener('click', async (e) => {
            const navBtn = e.target.closest('[data-navigate]');
            if (navBtn) {
                e.preventDefault();
                await this.navigate(navBtn.dataset.navigate);
                return;
            }

            const backBtn = e.target.closest('.back-btn, [data-back]');
            if (backBtn) {
                e.preventDefault();
                await this.back();
                return;
            }

            // More Menu Toggle
            const moreToggle = e.target.closest('#moreMenuToggle');
            if (moreToggle) {
                e.preventDefault();
                const drawer = document.getElementById('moreMenuDrawer');
                if (drawer && drawer.classList.contains('active')) {
                    await this.back();
                } else {
                    await this.navigate('more');
                }
                return;
            }

            // Click outside drawers
            const drawer = document.getElementById('moreMenuDrawer');
            if (drawer && drawer.classList.contains('active') && !e.target.closest('#moreMenuDrawer') && !e.target.closest('#moreMenuToggle')) {
                drawer.classList.remove('active');
                if (window.location.hash === '#more') {
                    history.back();
                }
            }

            const filterDrawer = document.getElementById('filterMenuDrawer');
            if (filterDrawer && filterDrawer.classList.contains('active') && !e.target.closest('#filterMenuDrawer') && !e.target.closest('.global-filter-btn')) {
                filterDrawer.classList.remove('active');
                if (window.location.hash === '#filterDrawer') {
                    history.back();
                }
            }
        });

        // Listen for browser Back/Forward (popstate & hashchange)
        window.addEventListener('popstate', (e) => this.handlePopState(e));
        window.addEventListener('hashchange', (e) => this.handleHashChange(e));
    }

    addRoute(name, renderFunction) {
        this.routes[name] = renderFunction;
    }

    getLogicalParent(route) {
        if (!route) return 'dashboard';
        const parts = route.split(':');
        const base = parts[0];
        if (parts.length > 1) {
            return base; // e.g. clients:view:123 -> clients
        }
        const secondaryPages = ['services', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'reports', 'notes', 'settings', 'data'];
        if (secondaryPages.includes(base)) {
            return 'dashboard';
        }
        return 'dashboard';
    }

    async back() {
        if (this.isFormDirty && window.showDiscardConfirm) {
            const discard = await window.showDiscardConfirm();
            if (!discard) return;
            this.isFormDirty = false;
        }

        // Close active drawers first
        const filterDrawer = document.getElementById('filterMenuDrawer');
        if (filterDrawer && filterDrawer.classList.contains('active')) {
            filterDrawer.classList.remove('active');
            if (window.location.hash === '#filterDrawer') {
                history.back();
                return;
            }
        }

        const moreDrawer = document.getElementById('moreMenuDrawer');
        if (moreDrawer && moreDrawer.classList.contains('active')) {
            moreDrawer.classList.remove('active');
            if (window.location.hash === '#more') {
                history.back();
                return;
            }
        }

        if (this.historyStack.length > 1) {
            this.historyStack.pop();
            history.back();
        } else {
            const parent = this.getLogicalParent(this.currentRoute);
            await this.navigate(parent, { replace: true });
        }
    }

    async handlePopState(e) {
        if (this.isNavigating) return;

        if (this.isFormDirty && window.showDiscardConfirm) {
            const discard = await window.showDiscardConfirm();
            if (!discard) {
                // Re-push current route to keep state
                if (this.currentRoute) {
                    history.pushState({ route: this.currentRoute }, '', '#' + this.currentRoute);
                }
                return;
            }
            this.isFormDirty = false;
        }

        const targetRoute = window.location.hash.slice(1) || 'dashboard';

        // Drawer handling on popstate
        const moreDrawer = document.getElementById('moreMenuDrawer');
        if (moreDrawer) {
            if (targetRoute === 'more') {
                moreDrawer.classList.add('active');
            } else {
                moreDrawer.classList.remove('active');
            }
        }

        const filterDrawer = document.getElementById('filterMenuDrawer');
        if (filterDrawer) {
            if (targetRoute === 'filterDrawer') {
                filterDrawer.classList.add('active');
            } else {
                filterDrawer.classList.remove('active');
            }
        }

        if (targetRoute !== 'more' && targetRoute !== 'filterDrawer') {
            await this.navigate(targetRoute, { skipHash: true, fromPopState: true });
        }
    }

    async handleHashChange(e) {
        const targetRoute = window.location.hash.slice(1) || 'dashboard';
        if (targetRoute !== 'more' && targetRoute !== 'filterDrawer' && targetRoute !== this.currentRoute) {
            await this.navigate(targetRoute, { skipHash: true });
        }
    }

    async navigate(fullRoute, options = {}) {
        if (this.isNavigating) return;
        this.isNavigating = true;

        try {
            if (this.isFormDirty && !options.force && window.showDiscardConfirm) {
                const discard = await window.showDiscardConfirm();
                if (!discard) {
                    this.isNavigating = false;
                    return;
                }
                this.isFormDirty = false;
            }

            // Drawer routes
            if (fullRoute === 'more') {
                const drawer = document.getElementById('moreMenuDrawer');
                if (drawer) drawer.classList.add('active');
                if (window.location.hash !== '#more') {
                    history.pushState({ route: 'more' }, '', '#more');
                }
                this.isNavigating = false;
                return;
            }

            if (fullRoute === 'filterDrawer') {
                const drawer = document.getElementById('filterMenuDrawer');
                if (drawer) drawer.classList.add('active');
                if (window.location.hash !== '#filterDrawer') {
                    history.pushState({ route: 'filterDrawer' }, '', '#filterDrawer');
                }
                this.isNavigating = false;
                return;
            }

            // Close drawers when navigating to actual page
            const moreDrawer = document.getElementById('moreMenuDrawer');
            if (moreDrawer) moreDrawer.classList.remove('active');
            const filterDrawer = document.getElementById('filterMenuDrawer');
            if (filterDrawer) filterDrawer.classList.remove('active');

            const baseRoute = fullRoute.split(':')[0];
            if (!this.routes[baseRoute]) {
                console.error(`Route ${baseRoute} not found`);
                this.isNavigating = false;
                return;
            }

            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });

            // Target page element
            let targetPage = document.getElementById(`page-${baseRoute}`);
            if (!targetPage) {
                const main = document.querySelector('main');
                targetPage = document.createElement('section');
                targetPage.id = `page-${baseRoute}`;
                targetPage.className = 'page active';
                main.appendChild(targetPage);
            } else {
                targetPage.classList.add('active');
            }

            // Update bottom nav buttons active state
            const secondaryPages = ['services', 'tasks', 'invoices', 'payments', 'expenses', 'team', 'reports', 'notes', 'settings', 'data'];
            document.querySelectorAll('.nav-btn').forEach(btn => {
                if (btn.id === 'moreMenuToggle') {
                    btn.classList.toggle('active', secondaryPages.includes(baseRoute));
                } else {
                    btn.classList.toggle('active', btn.dataset.navigate === baseRoute);
                }
            });

            // Update Hash / History State
            if (!options.skipHash) {
                if (options.replace) {
                    history.replaceState({ route: fullRoute }, '', '#' + fullRoute);
                } else if (window.location.hash !== '#' + fullRoute) {
                    history.pushState({ route: fullRoute }, '', '#' + fullRoute);
                }
            }

            if (!options.fromPopState) {
                if (this.historyStack[this.historyStack.length - 1] !== fullRoute) {
                    if (options.replace && this.historyStack.length > 0) {
                        this.historyStack[this.historyStack.length - 1] = fullRoute;
                    } else {
                        this.historyStack.push(fullRoute);
                    }
                }
            }

            this.currentRoute = fullRoute;
            this.isFormDirty = false;

            // Execute route render function
            await this.routes[baseRoute](fullRoute);

            // Auto-bind form dirty checking on rendered forms
            this.bindFormTracking(targetPage);

            // Scroll to top
            window.scrollTo(0, 0);
        } finally {
            this.isNavigating = false;
        }
    }

    bindFormTracking(container) {
        if (!container) return;
        container.querySelectorAll('form').forEach(form => {
            if (form.dataset.dirtyTracked) return;
            form.dataset.dirtyTracked = 'true';

            const markDirty = () => { this.isFormDirty = true; };
            form.addEventListener('input', markDirty);
            form.addEventListener('change', markDirty);
            form.addEventListener('submit', () => { this.isFormDirty = false; });
        });
    }
}

window.appRouter = new Router();