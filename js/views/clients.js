// Clients View
window.appRouter.addRoute('clients', async () => {
    const container = document.getElementById('page-clients');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Clients</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <input class="search" id="clientSearch" placeholder="Search clients...">
                <button class="btn primary" id="newClientBtn">+ New Client</button>
            </div>
            <div id="clientList">Loading...</div>
        </div>
    `;

    // Fetch and render
    let clients = await window.appDB.getAll('clients');
    clients = filterDataByDate(clients, 'dateAdded');

    const renderClients = (filter = "") => {
        const list = clients.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
        const listContainer = document.getElementById('clientList');

        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty">No clients found.</div>';
            return;
        }

        listContainer.innerHTML = list.sort((a,b) => a.name.localeCompare(b.name)).map(c => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(c.name)}</div>
                        ${c.company ? `<div class="list-item-meta">${escapeHTML(c.company)}</div>` : ''}
                    </div>
                </div>
                <div class="list-item-actions">
                    <button class="btn small" data-view-client="${c.id}">View Profile</button>
                    <button class="btn small" data-edit-client="${c.id}">Edit</button>
                    <button class="btn small danger" data-delete-client="${c.id}">Delete</button>
                </div>
            </div>
        `).join('');
    };

    renderClients();

    document.getElementById('clientSearch').addEventListener('input', (e) => {
        renderClients(e.target.value);
    });

    document.getElementById('newClientBtn').onclick = () => {
        showClientForm();
    };

    // Delegate list clicks
    document.getElementById('clientList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editClient) {
            const client = await window.appDB.get('clients', btn.dataset.editClient);
            showClientForm(client);
        } else if (btn.dataset.deleteClient) {
            if (confirm("Are you sure you want to delete this client? Related data may be orphaned.")) {
                await window.appDB.delete('clients', btn.dataset.deleteClient);
                clients = await window.appDB.getAll('clients');
                renderClients(document.getElementById('clientSearch').value);
            }
        } else if (btn.dataset.viewClient) {
            showClientProfile(btn.dataset.viewClient);
        }
    };
});

function showClientForm(client = null) {
    const isEdit = !!client;
    const container = document.getElementById('page-clients');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Client' : 'New Client'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelClientBtn">Cancel</button>
            </div>
            <form id="clientForm">
                <div class="row">
                    <div class="field">
                        <label>Client Name *</label>
                        <input id="cf-name" required value="${isEdit ? escapeHTML(client.name) : ''}">
                    </div>
                    <div class="field">
                        <label>Company</label>
                        <input id="cf-company" value="${isEdit ? escapeHTML(client.company) : ''}">
                    </div>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Phone</label>
                        <input id="cf-phone" type="tel" value="${isEdit ? escapeHTML(client.phone) : ''}">
                    </div>
                    <div class="field">
                        <label>WhatsApp</label>
                        <input id="cf-whatsapp" type="tel" value="${isEdit ? escapeHTML(client.whatsapp) : ''}">
                    </div>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Email</label>
                        <input id="cf-email" type="email" value="${isEdit ? escapeHTML(client.email) : ''}">
                    </div>
                    <div class="field">
                        <label>Status</label>
                        <select id="cf-status">
                            <option value="Active" ${isEdit && client.status === 'Active' ? 'selected' : ''}>Active</option>
                            <option value="Lead" ${isEdit && client.status === 'Lead' ? 'selected' : ''}>Lead</option>
                            <option value="Inactive" ${isEdit && client.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                </div>
                <div class="field">
                    <label>Address</label>
                    <textarea id="cf-address" style="min-height:60px">${isEdit ? escapeHTML(client.address) : ''}</textarea>
                </div>
                <div class="field">
                    <label>Notes</label>
                    <textarea id="cf-notes">${isEdit ? escapeHTML(client.notes) : ''}</textarea>
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Client</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelClientBtn').onclick = () => window.appRouter.navigate('clients');
    document.getElementById('clientForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            id: isEdit ? client.id : generateId(),
            name: document.getElementById('cf-name').value.trim(),
            company: document.getElementById('cf-company').value.trim(),
            phone: document.getElementById('cf-phone').value.trim(),
            whatsapp: document.getElementById('cf-whatsapp').value.trim(),
            email: document.getElementById('cf-email').value.trim(),
            status: document.getElementById('cf-status').value,
            address: document.getElementById('cf-address').value.trim(),
            notes: document.getElementById('cf-notes').value.trim(),
            dateAdded: isEdit ? client.dateAdded : new Date().toISOString()
        };
        await window.appDB.put('clients', data);
        window.appRouter.navigate('clients');
    };
}

async function showClientProfile(clientId) {
    const client = await window.appDB.get('clients', clientId);
    if (!client) return window.appRouter.navigate('clients');

    // Quick load related entities
    const projects = await window.appDB.getByIndex('projects', 'clientId', clientId);
    const quotes = await window.appDB.getByIndex('quotes', 'clientId', clientId);
    const invoices = await window.appDB.getByIndex('invoices', 'clientId', clientId);

    const container = document.getElementById('page-clients');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn" id="backToClients">← Back</button>
                <button class="btn primary" id="editProfileBtn">Edit Profile</button>
            </div>

            <div style="margin-top: 15px; margin-bottom: 25px;">
                <h1 style="margin-bottom: 4px;">${escapeHTML(client.name)}</h1>
                ${client.company ? `<div class="subtitle" style="font-size:14px">${escapeHTML(client.company)}</div>` : ''}
                <div style="margin-top: 10px; display:flex; gap:10px; flex-wrap:wrap;">
                    <span style="background:var(--green-soft); color:var(--green); padding:4px 8px; border-radius:8px; font-size:12px; font-weight:bold;">${client.status || 'Active'}</span>
                    ${client.phone ? `<a href="tel:${client.phone}" class="btn small" style="text-decoration:none">📞 ${client.phone}</a>` : ''}
                    ${client.whatsapp ? `<a href="https://wa.me/${client.whatsapp}" target="_blank" class="btn small" style="text-decoration:none">💬 WA</a>` : ''}
                    ${client.email ? `<a href="mailto:${client.email}" class="btn small" style="text-decoration:none">✉️ Email</a>` : ''}
                </div>
            </div>

            <div class="grid">
                <div class="col-4 metric">
                    <div class="metric-label">Projects</div>
                    <div class="metric-value">${projects.length}</div>
                </div>
                <div class="col-4 metric">
                    <div class="metric-label">Quotes</div>
                    <div class="metric-value">${quotes.length}</div>
                </div>
                <div class="col-4 metric">
                    <div class="metric-label">Invoices</div>
                    <div class="metric-value">${invoices.length}</div>
                </div>
            </div>

            ${client.notes ? `
            <div style="margin-top: 20px; padding: 15px; background: var(--bg); border-radius: 12px;">
                <h3 style="margin-top:0">Notes</h3>
                <p style="margin:0; font-size:14px; white-space:pre-wrap">${escapeHTML(client.notes)}</p>
            </div>` : ''}

            <div style="margin-top: 25px;">
                <h3>Recent Quotes</h3>
                ${quotes.length === 0 ? '<p class="muted">No quotes found.</p>' :
                  quotes.slice(0,3).map(q => `<div class="list-item" style="padding:10px;"><div class="list-item-head"><div class="list-item-title" style="font-size:14px">${escapeHTML(q.invoice)} - Expected: ${formatMoney(calcExpected(q))}</div></div></div>`).join('')
                }
            </div>
            <button class="btn" style="margin-top: 15px;" data-navigate="quotes">Go to Quotes →</button>
        </div>
    `;

    document.getElementById('backToClients').onclick = () => window.appRouter.navigate('clients');
    document.getElementById('editProfileBtn').onclick = () => showClientForm(client);
}

function calcExpected(q) {
    const setup = Number(q.setupFee) || 0;
    const retainer = Number(q.retainer) || 0;
    const billable = (q.expenses || []).filter(e => e.billToClient).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const internal = (q.expenses || []).filter(e => !e.billToClient).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const api = (Number(q.dailyMessages) || 0) * 30 * Number(window.AppState.settings.metaRate || 0);
    return setup + retainer + billable - api - internal;
}
