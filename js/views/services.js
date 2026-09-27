// Services View (Automation Catalog)
window.appRouter.addRoute('services', async (fullRoute) => {
    const parts = (fullRoute || 'services').split(':');
    const subAction = parts[1];
    const id = parts[2];

    if (subAction === 'new') {
        await showServiceForm();
    } else if (subAction === 'edit' && id) {
        const service = await window.appDB.get('services', id);
        if (!service) return window.appRouter.navigate('services');
        await showServiceForm(service);
    } else {
        await renderServicesList();
    }
});

async function renderServicesList() {
    const container = document.getElementById('page-services');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backServicesBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">Service Catalog</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newServiceBtn">+ New Service</button>
            </div>

            <!-- Contextual Help -->
            <div class="help-box" style="margin-bottom:15px; padding:12px 14px; background:var(--primary-soft); border-radius:12px; font-size:13px; line-height:1.4;">
                <details>
                    <summary style="font-weight:700; cursor:pointer; color:var(--primary);">ℹ How Services Work</summary>
                    <div style="margin-top:8px;">
                        <strong>WHAT IT DOES:</strong> Defines reusable service products and pricing templates for your catalog.<br>
                        <strong>INPUT:</strong> Service name, category, setup price, monthly retainer price, and hourly rate.<br>
                        <strong>PROCESS:</strong> Service details are saved to IndexedDB.<br>
                        <strong>OUTPUT:</strong> Service becomes selectable when creating quotes, automatically auto-filling setup and retainer rates.<br>
                        <div style="margin-top:4px; font-style:italic;"><strong>EXAMPLE:</strong> "Facebook Ads Setup" (Price: ₹5,000) → Save → Select while creating a Quote to auto-populate prices.</div>
                    </div>
                </details>
            </div>

            <div id="serviceList">Loading...</div>
        </div>
    `;

    document.getElementById('backServicesBtn').onclick = () => window.appRouter.back();

    let services = await window.appDB.getAll('services');

    const renderServices = () => {
        const listContainer = document.getElementById('serviceList');
        if (services.length === 0) {
            listContainer.innerHTML = '<div class="empty">No services in catalog. Add your first service to get started.</div>';
            return;
        }

        listContainer.innerHTML = services.map(s => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(s.name)}</div>
                        <div class="list-item-meta">${escapeHTML(s.category || 'General')}</div>
                    </div>
                </div>
                <div style="display:flex; gap:10px; margin-top:10px; font-size:12px; flex-wrap:wrap;">
                    ${s.setupPrice > 0 ? `<div style="background:var(--bg); padding:4px 8px; border-radius:6px;">Setup: ${formatMoney(s.setupPrice, window.AppState.settings.currency)}</div>` : ''}
                    ${s.monthlyPrice > 0 ? `<div style="background:var(--bg); padding:4px 8px; border-radius:6px;">Monthly: ${formatMoney(s.monthlyPrice, window.AppState.settings.currency)}</div>` : ''}
                    ${s.hourlyPrice > 0 ? `<div style="background:var(--bg); padding:4px 8px; border-radius:6px;">Hourly: ${formatMoney(s.hourlyPrice, window.AppState.settings.currency)}</div>` : ''}
                </div>
                <div class="list-item-actions">
                    <button class="btn small" data-edit-service="${s.id}">Edit</button>
                    <button class="btn small danger" data-delete-service="${s.id}">Delete</button>
                </div>
            </div>
        `).join('');
    };

    renderServices();

    document.getElementById('newServiceBtn').onclick = () => window.appRouter.navigate('services:new');

    document.getElementById('serviceList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editService) {
            window.appRouter.navigate(`services:edit:${btn.dataset.editService}`);
        } else if (btn.dataset.deleteService) {
            if (await window.showConfirm("Delete this service from the catalog?")) {
                await window.appDB.delete('services', btn.dataset.deleteService);
                services = await window.appDB.getAll('services');
                renderServices();
            }
        }
    };
}

async function showServiceForm(service = null) {
    const isEdit = !!service;
    const container = document.getElementById('page-services');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backServiceFormBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">${isEdit ? 'Edit Service' : 'New Service'}</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            </div>
            <form id="serviceForm">
                <div class="row">
                    <div class="field">
                        <label>Service Name *</label>
                        <input id="sf-name" required value="${isEdit ? escapeHTML(service.name) : ''}">
                    </div>
                    <div class="field">
                        <label>Category</label>
                        <select id="sf-category">
                            <option value="Workflow Automation" ${isEdit && service.category === 'Workflow Automation' ? 'selected' : ''}>Workflow Automation</option>
                            <option value="WhatsApp Automation" ${isEdit && service.category === 'WhatsApp Automation' ? 'selected' : ''}>WhatsApp Automation</option>
                            <option value="Chatbot" ${isEdit && service.category === 'Chatbot' ? 'selected' : ''}>Chatbot</option>
                            <option value="Other" ${isEdit && service.category === 'Other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                </div>
                <div class="field">
                    <label>Description</label>
                    <textarea id="sf-desc" style="min-height:60px">${isEdit ? escapeHTML(service.description) : ''}</textarea>
                </div>

                <h3 style="margin-top:20px; border-bottom:1px solid var(--line); padding-bottom:5px;">Pricing</h3>
                <div class="row three">
                    <div class="field">
                        <label>Setup Price</label>
                        <input type="number" step="0.01" min="0" id="sf-setup" value="${isEdit ? service.setupPrice : '0'}">
                    </div>
                    <div class="field">
                        <label>Monthly Price</label>
                        <input type="number" step="0.01" min="0" id="sf-monthly" value="${isEdit ? service.monthlyPrice : '0'}">
                    </div>
                    <div class="field">
                        <label>Hourly Price</label>
                        <input type="number" step="0.01" min="0" id="sf-hourly" value="${isEdit ? service.hourlyPrice : '0'}">
                    </div>
                </div>

                <div style="margin-top:15px; display:flex; gap:10px;">
                    <button type="submit" class="btn green" style="flex:1;">Save Service</button>
                    <button type="button" class="btn" id="cancelServiceBtn">Cancel</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('backServiceFormBtn').onclick = () => window.appRouter.back();
    document.getElementById('cancelServiceBtn').onclick = () => window.appRouter.back();

    document.getElementById('serviceForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            id: isEdit ? service.id : generateId(),
            name: document.getElementById('sf-name').value.trim(),
            category: document.getElementById('sf-category').value,
            description: document.getElementById('sf-desc').value.trim(),
            setupPrice: Number(document.getElementById('sf-setup').value) || 0,
            monthlyPrice: Number(document.getElementById('sf-monthly').value) || 0,
            hourlyPrice: Number(document.getElementById('sf-hourly').value) || 0,
        };
        await window.appDB.put('services', data);
        window.appRouter.isFormDirty = false;
        window.appRouter.navigate('services');
    };
}