// Simple Invoice View
window.appRouter.addRoute('invoices', async () => {
    const container = document.getElementById('page-invoices');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Invoices</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newInvBtn">+ New Invoice</button>
            </div>
            <div id="invList">Loading...</div>
        </div>
    `;

    // allInvoices = every invoice (needed by the payment form); invoices = the date-filtered list shown on this page
    let allInvoices = await window.appDB.getAll('invoices');
    let invoices = filterDataByDate(allInvoices, 'date');
    let payments = await window.appDB.getAll('payments');
    const clients = await window.appDB.getAll('clients');
    const clientMap = {};
    clients.forEach(c => clientMap[c.id] = c.name);

    const renderInvoices = () => {
        const list = document.getElementById('invList');
        if (invoices.length === 0) {
            list.innerHTML = '<div class="empty">No invoices found.</div>';
            return;
        }

        list.innerHTML = invoices.sort((a,b) => new Date(b.date) - new Date(a.date)).map(inv => {
            const paid = payments.filter(p => p.invoiceId === inv.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const total = Number(inv.amount) || 0;
            const remaining = total - paid;

            let status = 'Unpaid';
            if (remaining <= 0) status = 'Paid';
            else if (paid > 0) status = 'Partial';

            return `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(inv.number)}</div>
                        <div class="list-item-meta">${escapeHTML(clientMap[inv.clientId] || 'Unknown Client')} • ${inv.date}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-weight:bold; font-size:15px">${formatMoney(total, window.AppState.settings.currency)}</div>
                        <div style="font-size:11px; color:${status === 'Paid' ? 'var(--green)' : status === 'Partial' ? 'var(--orange)' : 'var(--red)'}">${status}</div>
                    </div>
                </div>
                ${status !== 'Paid' ? `
                    <div style="margin-top:10px; font-size:12px; color:var(--muted)">
                        Remaining: ${formatMoney(remaining, window.AppState.settings.currency)}
                    </div>
                ` : ''}
                <div class="list-item-actions">
                    <button class="btn small" data-pay-inv="${inv.id}">+ Add Payment</button>
                    <button class="btn small danger" data-del-inv="${inv.id}">Delete</button>
                </div>
            </div>
            `;
        }).join('');
    };

    renderInvoices();

    document.getElementById('newInvBtn').onclick = () => showInvoiceForm(clients);

    document.getElementById('invList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.delInv) {
            if (confirm('Delete invoice? Associated payments will remain but orphan.')) {
                await window.appDB.delete('invoices', btn.dataset.delInv);
                allInvoices = await window.appDB.getAll('invoices');
                invoices = filterDataByDate(allInvoices, 'date'); // keep the active date filter after deleting
                renderInvoices();
            }
        } else if (btn.dataset.payInv) {
            showPaymentForm(btn.dataset.payInv, allInvoices, clientMap);
        }
    };
});

function showInvoiceForm(clients) {
    const s = window.AppState.settings;
    const nPrefix = s.invoicePrefix || "INV";
    const defaultNotes = s.defaultTerms ? s.defaultTerms + (s.footerText ? '\n\n' + s.footerText : '') : '';

    // Default due date logic based on validity
    let defaultDueDate = "";
    if (s.defaultQuoteValidity) {
        const d = new Date();
        d.setDate(d.getDate() + Number(s.defaultQuoteValidity));
        defaultDueDate = formatLocalDate(d); // local calendar date (toISOString() is UTC: off by one for e.g. India before 05:30)
    }

    const container = document.getElementById('page-invoices');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">New Invoice</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelInvBtn">Cancel</button>
            </div>
            <form id="invForm">
                <div class="row">
                    <div class="field">
                        <label>Invoice Number *</label>
                        <input id="if-num" required value="${nPrefix}-${Date.now().toString().slice(-4)}">
                    </div>
                    <div class="field">
                        <label>Date *</label>
                        <input type="date" id="if-date" required value="${getTodayDate()}">
                    </div>
                </div>
                <div class="field">
                    <label>Client *</label>
                    <select id="if-client" required>
                        <option value="">Select a client...</option>
                        ${clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Total Amount *</label>
                        <input type="number" step="0.01" min="0" id="if-amount" required>
                    </div>
                    <div class="field">
                        <label>Due Date</label>
                        <input type="date" id="if-due" value="${defaultDueDate}">
                    </div>
                </div>
                <div class="field">
                    <label>Notes / Items description</label>
                    <textarea id="if-notes" style="min-height: 120px;">${escapeHTML(defaultNotes)}</textarea>
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Invoice</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelInvBtn').onclick = () => window.appRouter.navigate('invoices');
    document.getElementById('invForm').onsubmit = async (e) => {
        e.preventDefault();
        const inv = {
            id: generateId(),
            number: document.getElementById('if-num').value.trim(),
            date: document.getElementById('if-date').value,
            clientId: document.getElementById('if-client').value,
            amount: Number(document.getElementById('if-amount').value),
            dueDate: document.getElementById('if-due').value,
            notes: document.getElementById('if-notes').value.trim()
        };
        await window.appDB.put('invoices', inv);
        window.appRouter.navigate('invoices');
    };
}

// Payments View
window.appRouter.addRoute('payments', async () => {
    const container = document.getElementById('page-payments');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Payments</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newPayBtn">+ Record Payment</button>
            </div>
            <div id="payList">Loading...</div>
        </div>
    `;

    let payments = await window.appDB.getAll('payments');
    payments = filterDataByDate(payments, 'date');
    // Invoices are only a LOOKUP here (invoice numbers on the payment rows + the invoice list of the payment form),
    // so they must NOT be date-filtered: a payment inside the selected period can belong to an older invoice.
    const invoices = await window.appDB.getAll('invoices');
    const clients = await window.appDB.getAll('clients');

    const clientMap = {};
    clients.forEach(c => clientMap[c.id] = c.name);

    const invMap = {};
    invoices.forEach(i => invMap[i.id] = i.number);

    const renderPayments = () => {
        const list = document.getElementById('payList');
        if (payments.length === 0) {
            list.innerHTML = '<div class="empty">No payments recorded.</div>';
            return;
        }

        list.innerHTML = payments.sort((a,b) => new Date(b.date) - new Date(a.date)).map(p => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${formatMoney(p.amount, window.AppState.settings.currency)}</div>
                        <div class="list-item-meta">${p.date} • ${p.method || 'Transfer'}</div>
                        <div style="font-size:11px; margin-top:4px;">Inv: ${escapeHTML(invMap[p.invoiceId] || 'Unknown')}</div>
                    </div>
                    <button class="btn small danger" data-del-pay="${p.id}">X</button>
                </div>
            </div>
        `).join('');
    };

    renderPayments();

    document.getElementById('newPayBtn').onclick = () => showPaymentForm(null, invoices, clientMap);

    document.getElementById('payList').onclick = async (e) => {
        if (e.target.dataset.delPay) {
            if (confirm('Delete this payment record?')) {
                await window.appDB.delete('payments', e.target.dataset.delPay);
                payments = filterDataByDate(await window.appDB.getAll('payments'), 'date'); // keep the active date filter after deleting
                renderPayments();
            }
        }
    };
});

function showPaymentForm(prefillInvId = null, invoices, clientMap) {
    const container = document.getElementById('page-invoices') || document.getElementById('page-payments');
    if (!container) return; // safety

    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Record Payment</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelPayBtn">Cancel</button>
            </div>
            <form id="payForm">
                <div class="field">
                    <label>Invoice *</label>
                    <select id="pf-invoice" required>
                        <option value="">Select Invoice...</option>
                        ${invoices.map(i => `<option value="${i.id}" ${prefillInvId === i.id ? 'selected' : ''}>${escapeHTML(i.number)} - ${escapeHTML(clientMap[i.clientId] || 'Unk')}</option>`).join('')}
                    </select>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Amount *</label>
                        <input type="number" step="0.01" min="0" id="pf-amount" required>
                    </div>
                    <div class="field">
                        <label>Date *</label>
                        <input type="date" id="pf-date" required value="${getTodayDate()}">
                    </div>
                </div>
                <div class="field">
                    <label>Payment Method</label>
                    <select id="pf-method">
                        <option>Bank Transfer</option>
                        <option>UPI</option>
                        <option>Cash</option>
                        <option>Card</option>
                        <option>Other</option>
                    </select>
                </div>
                <div class="field">
                    <label>Notes</label>
                    <input id="pf-notes">
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Payment</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelPayBtn').onclick = () => prefillInvId ? window.appRouter.navigate('invoices') : window.appRouter.navigate('payments');

    document.getElementById('payForm').onsubmit = async (e) => {
        e.preventDefault();
        const pay = {
            id: generateId(),
            invoiceId: document.getElementById('pf-invoice').value,
            amount: Number(document.getElementById('pf-amount').value),
            date: document.getElementById('pf-date').value,
            method: document.getElementById('pf-method').value,
            notes: document.getElementById('pf-notes').value.trim()
        };
        await window.appDB.put('payments', pay);
        prefillInvId ? window.appRouter.navigate('invoices') : window.appRouter.navigate('payments');
    };
}

// Expenses View
window.appRouter.addRoute('expenses', async () => {
    const container = document.getElementById('page-expenses');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Expenses</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newExpBtn">+ Add Expense</button>
            </div>
            <div id="expList">Loading...</div>
        </div>
    `;

    let expenses = await window.appDB.getAll('expenses');
    expenses = filterDataByDate(expenses, 'date');

    const renderExpenses = () => {
        const list = document.getElementById('expList');
        if (expenses.length === 0) {
            list.innerHTML = '<div class="empty">No expenses recorded.</div>';
            return;
        }

        list.innerHTML = expenses.sort((a,b) => new Date(b.date) - new Date(a.date)).map(e => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(e.name)}</div>
                        <div class="list-item-meta">${e.date} • ${escapeHTML(e.category || 'General')}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-weight:bold; font-size:15px; color:var(--red)">-${formatMoney(e.amount, window.AppState.settings.currency)}</div>
                    </div>
                </div>
                <div class="list-item-actions">
                    <button class="btn small danger" data-del-exp="${e.id}">Delete</button>
                </div>
            </div>
        `).join('');
    };

    renderExpenses();

    document.getElementById('newExpBtn').onclick = () => showExpenseForm();

    document.getElementById('expList').onclick = async (e) => {
        if (e.target.dataset.delExp) {
            if (await window.showConfirm('Delete this expense?')) {
                await window.appDB.delete('expenses', e.target.dataset.delExp);
                expenses = filterDataByDate(await window.appDB.getAll('expenses'), 'date'); // keep the active date filter after deleting
                renderExpenses();
            }
        }
    };
});

function showExpenseForm() {
    const container = document.getElementById('page-expenses');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Add Expense</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelExpBtn">Cancel</button>
            </div>
            <form id="expForm">
                <div class="field">
                    <label>Expense Name *</label>
                    <input id="ef-name" required placeholder="e.g. Software Subscription">
                </div>
                <div class="row">
                    <div class="field">
                        <label>Amount *</label>
                        <input type="number" step="0.01" min="0" id="ef-amount" required>
                    </div>
                    <div class="field">
                        <label>Date *</label>
                        <input type="date" id="ef-date" required value="${getTodayDate()}">
                    </div>
                </div>
                <div class="field">
                    <label>Category</label>
                    <select id="ef-category">
                        <option>Software</option>
                        <option>Marketing</option>
                        <option>API Costs</option>
                        <option>Contractor</option>
                        <option>Office</option>
                        <option>Other</option>
                    </select>
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Expense</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelExpBtn').onclick = () => window.appRouter.navigate('expenses');
    document.getElementById('expForm').onsubmit = async (e) => {
        e.preventDefault();
        const exp = {
            id: generateId(),
            name: document.getElementById('ef-name').value.trim(),
            amount: Number(document.getElementById('ef-amount').value),
            date: document.getElementById('ef-date').value,
            category: document.getElementById('ef-category').value
        };
        await window.appDB.put('expenses', exp);
        window.appRouter.navigate('expenses');
    };
}