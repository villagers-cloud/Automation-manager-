// Quotes View
window.appRouter.addRoute('quotes', async () => {
    const container = document.getElementById('page-quotes');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Quotes</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <input class="search" id="quoteSearch" placeholder="Search quotes...">
                <button class="btn primary" id="newQuoteBtn">+ New Quote</button>
            </div>
            <div id="quoteList">Loading...</div>
        </div>
    `;

    let quotes = await window.appDB.getAll('quotes');
    // Ensure we have up-to-date client names (since clients can be edited)
    for (let q of quotes) {
        if (q.clientId) {
            const client = await window.appDB.get('clients', q.clientId);
            if (client) q.clientNameTemp = client.name;
        }
    }

    const renderQuotes = (filter = "") => {
        const list = quotes.filter(q => (q.clientNameTemp || "").toLowerCase().includes(filter.toLowerCase()) || (q.invoice || "").toLowerCase().includes(filter.toLowerCase()));
        const listContainer = document.getElementById('quoteList');

        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty">No quotes found.</div>';
            return;
        }

        listContainer.innerHTML = list.sort((a,b) => new Date(b.created) - new Date(a.created)).map(q => {
            const expected = calcExpected(q);
            const loss = q.actualProfit !== "" && q.actualProfit !== undefined && Number(q.actualProfit) < expected;
            return `
            <div class="list-item ${loss ? 'danger-zone' : ''}">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(q.clientNameTemp || "Unnamed Client")}</div>
                        <div class="list-item-meta">${escapeHTML(q.invoice)} • ${escapeHTML(q.date)} • Exp: ${formatMoney(expected, window.AppState.settings.currency)}</div>
                    </div>
                    <select class="status-select" data-status-quote="${q.id}" style="width: auto; padding: 4px 8px; border-radius: 8px; font-weight: bold; color: ${q.status === 'Pending' ? 'var(--orange)' : 'var(--green)'}">
                        ${["Draft", "Pending", "Sent", "Approved", "Paid", "Rejected"].map(s => `<option ${q.status === s ? "selected" : ""}>${s}</option>`).join("")}
                    </select>
                </div>
                ${loss ? `<div style="color:var(--red);font-size:12px;font-weight:700;margin-top:5px">Actual profit below expected.</div>` : ""}
                <div class="list-item-actions">
                    <button class="btn small" data-edit-quote="${q.id}">Edit</button>
                    <button class="btn small" data-dup-quote="${q.id}">Duplicate</button>
                    <button class="btn small" data-pdf-quote="${q.id}">PDF</button>
                    <button class="btn small danger" data-delete-quote="${q.id}">Delete</button>
                </div>
            </div>
        `}).join('');
    };

    renderQuotes();

    document.getElementById('quoteSearch').addEventListener('input', (e) => {
        renderQuotes(e.target.value);
    });

    document.getElementById('newQuoteBtn').onclick = () => showQuoteForm();

    document.getElementById('quoteList').addEventListener('change', async (e) => {
        if (e.target.dataset.statusQuote) {
            const q = await window.appDB.get('quotes', e.target.dataset.statusQuote);
            if (q) {
                q.status = e.target.value;
                await window.appDB.put('quotes', q);
                quotes = await window.appDB.getAll('quotes');
                // Refresh list but keep search
                renderQuotes(document.getElementById('quoteSearch').value);
            }
        }
    });

    document.getElementById('quoteList').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editQuote) {
            const q = await window.appDB.get('quotes', btn.dataset.editQuote);
            showQuoteForm(q);
        } else if (btn.dataset.dupQuote) {
            const q = await window.appDB.get('quotes', btn.dataset.dupQuote);
            showQuoteForm(q, true);
        } else if (btn.dataset.deleteQuote) {
            if (confirm("Delete this quote?")) {
                await window.appDB.delete('quotes', btn.dataset.deleteQuote);
                quotes = await window.appDB.getAll('quotes');
                renderQuotes();
            }
        } else if (btn.dataset.pdfQuote) {
            const q = await window.appDB.get('quotes', btn.dataset.pdfQuote);
            generatePdf(q);
        }
    });
});

async function showQuoteForm(quote = null, isDuplicate = false) {
    const isEdit = quote && !isDuplicate;
    const container = document.getElementById('page-quotes');

    // Fetch dependencies
    const clients = await window.appDB.getAll('clients');
    const services = await window.appDB.getAll('services');

    // Next invoice number
    let nextInv = window.AppState.settings.invoicePrefix + "-001";
    if (!isEdit) {
        const allQuotes = await window.appDB.getAll('quotes');
        let max = 0;
        allQuotes.forEach(q => {
            const match = String(q.invoice || "").match(/(\d+)$/);
            if (match) max = Math.max(max, Number(match[1]));
        });
        nextInv = `${window.AppState.settings.invoicePrefix}-${String(max + 1).padStart(3, "0")}`;
    }

    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Quote' : 'New Quote'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelQuoteBtn">Cancel</button>
            </div>

            <form id="quoteForm">
                <div class="row">
                    <div class="field">
                        <label>Client *</label>
                        <select id="qf-client" required>
                            <option value="">Select a client...</option>
                            ${clients.map(c => `<option value="${c.id}" ${quote && quote.clientId === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field">
                        <label>Date *</label>
                        <input type="date" id="qf-date" required value="${isEdit ? quote.date : getTodayDate()}">
                    </div>
                </div>

                <div class="row three">
                    <div class="field">
                        <label>Invoice Number</label>
                        <input id="qf-invoice" value="${isEdit ? quote.invoice : nextInv}" readonly>
                    </div>
                    <div class="field">
                        <label>Setup Fee</label>
                        <input type="number" id="qf-setup" min="0" step="0.01" value="${quote ? quote.setupFee : '0'}">
                    </div>
                    <div class="field">
                        <label>Monthly Retainer</label>
                        <input type="number" id="qf-retainer" min="0" step="0.01" value="${quote ? quote.retainer : '0'}">
                    </div>
                </div>

                <div style="margin-top: 15px; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0">Catalog Services</h3>
                    <select id="qf-add-service" style="width: auto; padding: 4px; font-size:12px;">
                        <option value="">+ Add Service to Quote</option>
                        ${services.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('')}
                    </select>
                </div>

                <div id="qf-services-list" style="margin-top: 10px;"></div>

                <h3 style="margin-top:20px;">Deliverables (Simple Checklist)</h3>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;" id="qf-deliverables">
                    ${window.AppState.settings.deliverables.map(d => {
                        const checked = quote && quote.deliverables && quote.deliverables.includes(d);
                        return `<label style="display:flex; align-items:center; gap:5px; background:var(--bg); padding:8px; border-radius:8px;"><input type="checkbox" value="${escapeHTML(d)}" ${checked ? 'checked' : ''}> ${escapeHTML(d)}</label>`;
                    }).join('')}
                </div>

                <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0">Custom Line Items / Expenses</h3>
                    <button type="button" class="btn small" id="qf-add-expense">+ Add Item</button>
                </div>
                <div id="qf-expenses-list" style="margin-top: 10px;"></div>

                <h3 style="margin-top:20px;">API & Profit Calculation</h3>
                <div class="row">
                    <div class="field">
                        <label>Expected Daily Messages</label>
                        <input type="number" id="qf-messages" min="0" step="1" value="${quote ? quote.dailyMessages || 0 : '0'}">
                    </div>
                    <div class="field">
                        <label>Actual Profit (Optional)</label>
                        <input type="number" id="qf-actual-profit" min="0" step="0.01" value="${quote && quote.actualProfit !== undefined ? quote.actualProfit : ''}">
                    </div>
                </div>

                <div style="background:var(--bg); padding:15px; border-radius:12px; margin-top:10px;">
                    <div style="display:flex; justify-content:space-between; font-weight:bold;">
                        <span>Expected Profit:</span>
                        <span id="qf-expected-display">₹0</span>
                    </div>
                </div>

                <div class="field" style="margin-top:20px;">
                    <label>Notes / Terms</label>
                    <textarea id="qf-notes">${quote ? escapeHTML(quote.notes || "") : ""}</textarea>
                </div>

                <div style="margin-top:20px;">
                    <button type="submit" class="btn green">Save Quote</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelQuoteBtn').onclick = () => window.appRouter.navigate('quotes');

    // Manage dynamic arrays (Services from catalog, Expenses)
    const servicesListEl = document.getElementById('qf-services-list');
    const expensesListEl = document.getElementById('qf-expenses-list');

    // Re-add expenses
    if (quote && quote.expenses) {
        quote.expenses.forEach(e => addExpenseRow(e.name, e.amount, e.billToClient));
    }

    function addExpenseRow(name = "", amount = "", billToClient = true) {
        const div = document.createElement('div');
        div.style.display = 'grid';
        div.style.gridTemplateColumns = '2fr 1fr auto auto';
        div.style.gap = '10px';
        div.style.alignItems = 'center';
        div.style.marginBottom = '10px';
        div.innerHTML = `
            <input class="exp-name" placeholder="Item name" value="${escapeHTML(name)}">
            <input class="exp-amount" type="number" min="0" step="0.01" placeholder="Amount" value="${amount}">
            <label style="margin:0; display:flex; align-items:center; gap:5px;"><input type="checkbox" class="exp-bill" ${billToClient ? 'checked' : ''}> Bill Client</label>
            <button type="button" class="btn small danger remove-exp">X</button>
        `;
        div.querySelector('.remove-exp').onclick = () => { div.remove(); updateTotals(); };
        expensesListEl.appendChild(div);
    }

    document.getElementById('qf-add-expense').onclick = () => addExpenseRow();

    // Add service from catalog
    document.getElementById('qf-add-service').onchange = async (e) => {
        if (!e.target.value) return;
        const s = await window.appDB.get('services', e.target.value);
        if (s) {
            // Inject into quote totals
            document.getElementById('qf-setup').value = (Number(document.getElementById('qf-setup').value) + s.setupPrice).toFixed(2);
            document.getElementById('qf-retainer').value = (Number(document.getElementById('qf-retainer').value) + s.monthlyPrice).toFixed(2);
            // Optionally add as line item if it has hourly (ignoring for simplicity in quick setup)
            updateTotals();
        }
        e.target.value = ""; // reset select
    };

    const updateTotals = () => {
        const setup = Number(document.getElementById('qf-setup').value) || 0;
        const retainer = Number(document.getElementById('qf-retainer').value) || 0;
        let billable = 0;
        let internal = 0;

        document.querySelectorAll('#qf-expenses-list > div').forEach(row => {
            const amt = Number(row.querySelector('.exp-amount').value) || 0;
            if (row.querySelector('.exp-bill').checked) billable += amt;
            else internal += amt;
        });

        const api = (Number(document.getElementById('qf-messages').value) || 0) * 30 * Number(window.AppState.settings.metaRate || 0);
        const expected = setup + retainer + billable - api - internal;

        document.getElementById('qf-expected-display').textContent = formatMoney(expected, window.AppState.settings.currency);
    };

    document.getElementById('quoteForm').addEventListener('input', updateTotals);
    updateTotals(); // initial call

    document.getElementById('quoteForm').onsubmit = async (e) => {
        e.preventDefault();

        const expenses = [];
        document.querySelectorAll('#qf-expenses-list > div').forEach(row => {
            const name = row.querySelector('.exp-name').value.trim();
            const amt = Number(row.querySelector('.exp-amount').value) || 0;
            if (name || amt) {
                expenses.push({ name, amount: amt, billToClient: row.querySelector('.exp-bill').checked });
            }
        });

        const deliverables = [];
        document.querySelectorAll('#qf-deliverables input:checked').forEach(cb => deliverables.push(cb.value));

        const clientId = document.getElementById('qf-client').value;
        const client = await window.appDB.get('clients', clientId);

        const data = {
            id: isEdit ? quote.id : generateId(),
            clientId: clientId,
            clientNameTemp: client ? client.name : "", // cache name
            invoice: document.getElementById('qf-invoice').value,
            date: document.getElementById('qf-date').value,
            setupFee: Number(document.getElementById('qf-setup').value) || 0,
            retainer: Number(document.getElementById('qf-retainer').value) || 0,
            dailyMessages: Number(document.getElementById('qf-messages').value) || 0,
            actualProfit: document.getElementById('qf-actual-profit').value,
            notes: document.getElementById('qf-notes').value.trim(),
            status: isEdit ? quote.status : "Pending",
            created: isEdit ? quote.created : new Date().toISOString(),
            expenses,
            deliverables
        };

        await window.appDB.put('quotes', data);
        window.appRouter.navigate('quotes');
    };
}

// PDF Generation
async function generatePdf(q) {
    if (typeof html2pdf === "undefined") {
        alert("PDF library is unavailable offline. Wait for connection or ensure it is cached.");
        return;
    }

    let clientName = q.clientNameTemp;
    if (q.clientId) {
        const client = await window.appDB.get('clients', q.clientId);
        if (client) clientName = client.name;
    }

    const s = window.AppState.settings;
    const template = document.getElementById('pdfTemplate');
    template.style.display = 'block';

    // Calculation
    const setup = Number(q.setupFee) || 0;
    const retainer = Number(q.retainer) || 0;
    const billable = (q.expenses || []).filter(e => e.billToClient).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const subtotal = setup + retainer + billable;
    const tax = subtotal * (Number(s.taxRate) || 0) / 100;
    const total = subtotal + tax;

    const items = [];
    if(setup) items.push(["Setup Fee", setup]);
    if(retainer) items.push(["Monthly Retainer", retainer]);
    if(billable) items.push(["Billable Extra Charges", billable]);
    if(q.deliverables?.length) items.push(["Deliverables: " + q.deliverables.join(", "), "Included"]);

    template.innerHTML = `
        <div style="padding:42px; background:#fff; color:#222; font-family:Arial,sans-serif; width:794px;">
            <div style="display:flex; justify-content:space-between; border-bottom:3px solid #5d9474; padding-bottom:20px; margin-bottom:24px">
                <div>
                    ${s.logoUrl ? `<img src="${s.logoUrl}" style="max-height:70px; max-width:180px; object-fit:contain">` : ''}
                    <h1 style="margin:8px 0 0; color:#222">${escapeHTML(s.agencyName)}</h1>
                </div>
                <div style="text-align:right">
                    <div style="font-size:28px; font-weight:800; color:#416b59">INVOICE/QUOTE</div>
                    <div>Ref: <strong>${escapeHTML(q.invoice)}</strong></div>
                    <div>Date: <span>${escapeHTML(q.date)}</span></div>
                </div>
            </div>
            <h3>Bill To</h3>
            <div style="font-size:18px; margin-bottom:18px">${escapeHTML(clientName)}</div>
            <table style="width:100%; border-collapse:collapse; margin-top:20px">
                <thead><tr>
                    <th style="border-bottom:1px solid #ddd; padding:11px; text-align:left">Description</th>
                    <th style="border-bottom:1px solid #ddd; padding:11px; text-align:right">Amount</th>
                </tr></thead>
                <tbody>
                    ${items.map(i => `<tr>
                        <td style="border-bottom:1px solid #ddd; padding:11px;">${escapeHTML(i[0])}</td>
                        <td style="border-bottom:1px solid #ddd; padding:11px; text-align:right">${typeof i[1] === "number" ? formatMoney(i[1], s.currency) : i[1]}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
            <div style="margin-left:auto; margin-top:20px; width:300px">
                <div style="display:flex; justify-content:space-between; padding:6px">
                    <span>Subtotal</span><strong>${formatMoney(subtotal, s.currency)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; padding:6px">
                    <span>Tax (${s.taxRate}%)</span><strong>${formatMoney(tax, s.currency)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; padding:6px; font-size:18px; font-weight:800; border-top:2px solid #5d9474">
                    <span>Grand Total</span><strong>${formatMoney(total, s.currency)}</strong>
                </div>
            </div>
            <div style="margin-top:32px">
                <h3>Notes / Terms & Conditions</h3>
                <div style="white-space:pre-wrap; line-height:1.5">${escapeHTML(q.notes || "")}</div>
            </div>
            ${s.upiQrUrl ? `
            <div style="margin-top:25px">
                <div>Scan to pay via UPI</div>
                <img src="${s.upiQrUrl}" style="max-width:130px; max-height:130px; margin-top:10px">
            </div>` : ''}
        </div>
    `;

    await html2pdf().set({
        margin:0, filename:`${q.invoice}-${clientName}.pdf`,
        image:{type:"jpeg", quality:.97}, html2canvas:{scale:2, useCORS:true},
        jsPDF:{unit:"mm", format:"a4", orientation:"portrait"}
    }).from(template.firstElementChild).save();

    template.style.display = 'none';
}