// Services View (Automation Catalog)
window.appRouter.addRoute('services', async () => {
    const container = document.getElementById('page-services');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Service Catalog</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newServiceBtn">+ New Service</button>
            </div>
            <div id="serviceList">Loading...</div>
        </div>
    `;

    let services = await window.appDB.getAll('services');

    const renderServices = () => {
        const listContainer = document.getElementById('serviceList');
        if (services.length === 0) {
            listContainer.innerHTML = '<div class="empty">No services in catalog.</div>';
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
                <div style="display:flex; gap:10px; margin-top:10px; font-size:12px;">
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

    document.getElementById('newServiceBtn').onclick = () => showServiceForm();

    document.getElementById('serviceList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editService) {
            const service = await window.appDB.get('services', btn.dataset.editService);
            showServiceForm(service);
        } else if (btn.dataset.deleteService) {
            if (confirm("Delete this service from the catalog?")) {
                await window.appDB.delete('services', btn.dataset.deleteService);
                services = await window.appDB.getAll('services');
                renderServices();
            }
        }
    };
});

function showServiceForm(service = null) {
    const isEdit = !!service;
    const container = document.getElementById('page-services');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Service' : 'New Service'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelServiceBtn">Cancel</button>
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
                            <option value="AI Automation" ${isEdit && service.category === 'AI Automation' ? 'selected' : ''}>AI Automation</option>
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

                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Service</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelServiceBtn').onclick = () => window.appRouter.navigate('services');
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
        window.appRouter.navigate('services');
    };
}