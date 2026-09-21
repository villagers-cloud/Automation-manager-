window.appRouter.addRoute('dashboard', async () => {
    const container = document.getElementById('page-dashboard');
    container.innerHTML = `
      <div class="grid">
        <div class="col-12">
          <div class="metrics">
            <div class="metric">
              <div class="metric-label">Approved/Paid MRR</div>
              <div class="metric-value" id="dashMRR">₹0</div>
            </div>
            <div class="metric neutral">
              <div class="metric-label">Total Quotes</div>
              <div class="metric-value" id="dashQuotes">0</div>
            </div>
            <div class="metric" id="dashHealth">
              <div class="metric-label">Expected Profit</div>
              <div class="metric-value" id="dashProfit">₹0</div>
            </div>
          </div>
        </div>
        <div class="col-12 card">
          <div class="toolbar">
            <h2 style="margin:0">Recent Quotes</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            <button class="btn primary" data-navigate="quotes">+ New Quote</button>
          </div>
          <div id="dashRecentQuotes">Loading...</div>
        </div>
      </div>
    `;

    // Fetch dashboard data
    let quotes = await window.appDB.getAll('quotes');
    quotes = filterDataByDate(quotes, 'date');

    let mrr = 0;
    let expectedProfit = 0;

    quotes.forEach(q => {
        if (["Approved", "Paid"].includes(q.status)) {
            mrr += (Number(q.retainer) || 0);
        }

        // Quick recalc logic from old app
        const setup = Number(q.setupFee) || 0;
        const retainer = Number(q.retainer) || 0;
        const billable = (q.expenses || []).filter(e => e.billToClient).reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const internal = (q.expenses || []).filter(e => !e.billToClient).reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const api = (Number(q.dailyMessages) || 0) * 30 * Number(window.AppState.settings.metaRate || 0);
        const expected = setup + retainer + billable - api - internal;

        expectedProfit += expected;
    });

    document.getElementById('dashMRR').textContent = formatMoney(mrr, window.AppState.settings.currency);
    document.getElementById('dashQuotes').textContent = quotes.length;
    document.getElementById('dashProfit').textContent = formatMoney(expectedProfit, window.AppState.settings.currency);

    const healthEl = document.getElementById('dashHealth');
    if (healthEl) healthEl.classList.toggle('loss', expectedProfit < 0);

    // Render Recent Quotes
    const recentQuotes = quotes.sort((a,b) => new Date(b.created) - new Date(a.created)).slice(0, 5);
    const quotesContainer = document.getElementById('dashRecentQuotes');

    if (recentQuotes.length === 0) {
        quotesContainer.innerHTML = '<div class="empty">No quotes created yet.</div>';
    } else {
        quotesContainer.innerHTML = recentQuotes.map(q => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(q.clientNameTemp || 'Unknown Client')}</div>
                        <div class="list-item-meta">${escapeHTML(q.invoice)} • ${escapeHTML(q.date)}</div>
                    </div>
                    <span style="font-size: 12px; font-weight: 700; color: ${q.status === 'Pending' ? 'var(--orange)' : 'var(--green)'}">${q.status}</span>
                </div>
            </div>
        `).join('');
    }
});