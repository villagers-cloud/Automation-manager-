// Team View
window.appRouter.addRoute('team', async (fullRoute) => {
    const parts = (fullRoute || 'team').split(':');
    const subAction = parts[1];
    const id = parts[2];

    if (subAction === 'new') {
        await showTeamForm();
    } else if (subAction === 'edit' && id) {
        const member = await window.appDB.get('team', id);
        if (!member) return window.appRouter.navigate('team');
        await showTeamForm(member);
    } else {
        await renderTeamList();
    }
});

async function renderTeamList() {
    const container = document.getElementById('page-team');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backTeamBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">Team</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newTeamBtn">+ Add Member</button>
            </div>

            <!-- Contextual Help -->
            <div class="help-box" style="margin-bottom:15px; padding:12px 14px; background:var(--primary-soft); border-radius:12px; font-size:13px; line-height:1.4;">
                <details>
                    <summary style="font-weight:700; cursor:pointer; color:var(--primary);">ℹ How Team Works</summary>
                    <div style="margin-top:8px;">
                        <strong>WHAT IT DOES:</strong> Manages internal team members, roles, and contact details.<br>
                        <strong>INPUT:</strong> Member name, role (Admin, Developer, Sales, etc.), status, email, and phone.<br>
                        <strong>PROCESS:</strong> Team directory is saved locally in IndexedDB.<br>
                        <strong>OUTPUT:</strong> Clear roster of active agency personnel.<br>
                        <div style="margin-top:4px; font-style:italic;"><strong>EXAMPLE:</strong> Add "Rahul Verma" (Role: Developer) → Active status displayed in roster.</div>
                    </div>
                </details>
            </div>

            <div id="teamList">Loading...</div>
        </div>
    `;

    document.getElementById('backTeamBtn').onclick = () => window.appRouter.back();

    let team = await window.appDB.getAll('team');

    const renderTeam = () => {
        const list = document.getElementById('teamList');
        if (team.length === 0) {
            list.innerHTML = '<div class="empty">No team members added. Add your first team member to get started.</div>';
            return;
        }

        list.innerHTML = team.sort((a,b) => a.name.localeCompare(b.name)).map(t => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(t.name)}</div>
                        <div class="list-item-meta">${escapeHTML(t.role)}</div>
                    </div>
                    <span style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:8px; background:var(--bg); color:${t.active ? 'var(--green)' : 'var(--muted)'}">
                        ${t.active ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="list-item-actions">
                    <button class="btn small" data-edit-team="${t.id}">Edit</button>
                    <button class="btn small danger" data-del-team="${t.id}">Delete</button>
                </div>
            </div>
        `).join('');
    };

    renderTeam();

    document.getElementById('newTeamBtn').onclick = () => window.appRouter.navigate('team:new');

    document.getElementById('teamList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editTeam) {
            window.appRouter.navigate(`team:edit:${btn.dataset.editTeam}`);
        } else if (btn.dataset.delTeam) {
            if (await window.showConfirm('Delete this team member?')) {
                await window.appDB.delete('team', btn.dataset.delTeam);
                team = await window.appDB.getAll('team');
                renderTeam();
            }
        }
    };
}

async function showTeamForm(member = null) {
    const isEdit = !!member;
    const container = document.getElementById('page-team');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backTeamFormBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">${isEdit ? 'Edit Member' : 'New Member'}</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            </div>
            <form id="teamForm">
                <div class="field">
                    <label>Name *</label>
                    <input id="tmf-name" required value="${isEdit ? escapeHTML(member.name) : ''}">
                </div>
                <div class="row">
                    <div class="field">
                        <label>Role</label>
                        <select id="tmf-role">
                            <option ${isEdit && member.role === 'Admin' ? 'selected' : ''}>Admin</option>
                            <option ${isEdit && member.role === 'Manager' ? 'selected' : ''}>Manager</option>
                            <option ${isEdit && member.role === 'Developer' ? 'selected' : ''}>Developer</option>
                            <option ${isEdit && member.role === 'Sales' ? 'selected' : ''}>Sales</option>
                            <option ${isEdit && member.role === 'Accountant' ? 'selected' : ''}>Accountant</option>
                            <option ${isEdit && member.role === 'Support' ? 'selected' : ''}>Support</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>Status</label>
                        <select id="tmf-status">
                            <option value="active" ${isEdit && member.active === true ? 'selected' : ''}>Active</option>
                            <option value="inactive" ${isEdit && member.active === false ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Email</label>
                        <input type="email" id="tmf-email" value="${isEdit ? escapeHTML(member.email || '') : ''}">
                    </div>
                    <div class="field">
                        <label>Phone</label>
                        <input type="tel" id="tmf-phone" value="${isEdit ? escapeHTML(member.phone || '') : ''}">
                    </div>
                </div>
                <div style="margin-top:15px; display:flex; gap:10px;">
                    <button type="submit" class="btn green" style="flex:1;">Save Member</button>
                    <button type="button" class="btn" id="cancelTeamBtn">Cancel</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('backTeamFormBtn').onclick = () => window.appRouter.back();
    document.getElementById('cancelTeamBtn').onclick = () => window.appRouter.back();

    document.getElementById('teamForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            id: isEdit ? member.id : generateId(),
            name: document.getElementById('tmf-name').value.trim(),
            role: document.getElementById('tmf-role').value,
            active: document.getElementById('tmf-status').value === 'active',
            email: document.getElementById('tmf-email').value.trim(),
            phone: document.getElementById('tmf-phone').value.trim()
        };
        await window.appDB.put('team', data);
        window.appRouter.isFormDirty = false;
        window.appRouter.navigate('team');
    };
}

// Notes View
window.appRouter.addRoute('notes', async (fullRoute) => {
    const parts = (fullRoute || 'notes').split(':');
    const subAction = parts[1];
    const id = parts[2];

    if (subAction === 'new') {
        await showNoteForm();
    } else if (subAction === 'edit' && id) {
        const notes = await window.appDB.getAll('notes');
        const note = notes.find(n => n.id === id);
        if (!note) return window.appRouter.navigate('notes');
        await showNoteForm(note);
    } else {
        await renderNotesList();
    }
});

async function renderNotesList() {
    const container = document.getElementById('page-notes');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backNotesBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">Global Notes</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newNoteBtn">+ New Note</button>
            </div>

            <!-- Contextual Help -->
            <div class="help-box" style="margin-bottom:15px; padding:12px 14px; background:var(--primary-soft); border-radius:12px; font-size:13px; line-height:1.4;">
                <details>
                    <summary style="font-weight:700; cursor:pointer; color:var(--primary);">ℹ How Notes Work</summary>
                    <div style="margin-top:8px;">
                        <strong>WHAT IT DOES:</strong> Provides internal documentation and quick memo storage.<br>
                        <strong>INPUT:</strong> Note title and text content.<br>
                        <strong>PROCESS:</strong> Memos are timestamped and stored locally.<br>
                        <strong>OUTPUT:</strong> Easily searchable list of internal notes.<br>
                        <div style="margin-top:4px; font-style:italic;"><strong>EXAMPLE:</strong> Title: "Onboarding Checklist" → Content: Collect credentials, send invoice, schedule call.</div>
                    </div>
                </details>
            </div>

            <div id="noteList">Loading...</div>
        </div>
    `;

    document.getElementById('backNotesBtn').onclick = () => window.appRouter.back();

    let notes = await window.appDB.getAll('notes');

    const renderNotes = () => {
        const list = document.getElementById('noteList');
        if (notes.length === 0) {
            list.innerHTML = '<div class="empty">No notes found. Create your first note to get started.</div>';
            return;
        }

        list.innerHTML = notes.sort((a,b) => new Date(b.created) - new Date(a.created)).map(n => `
            <div class="list-item">
                <div class="list-item-head">
                    <div style="flex:1">
                        <div class="list-item-title">${escapeHTML(n.title)}</div>
                        <div class="list-item-meta">${new Date(n.created).toLocaleString()}</div>
                        <p style="margin-top:10px; font-size:14px; white-space:pre-wrap">${escapeHTML(n.content)}</p>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn small" data-edit-note="${n.id}">Edit</button>
                        <button class="btn small danger" data-del-note="${n.id}">X</button>
                    </div>
                </div>
            </div>
        `).join('');
    };

    renderNotes();

    document.getElementById('newNoteBtn').onclick = () => window.appRouter.navigate('notes:new');

    document.getElementById('noteList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editNote) {
            window.appRouter.navigate(`notes:edit:${btn.dataset.editNote}`);
        } else if (btn.dataset.delNote) {
            if (await window.showConfirm("Delete this note?")) {
                await window.appDB.delete('notes', btn.dataset.delNote);
                notes = await window.appDB.getAll('notes');
                renderNotes();
            }
        }
    };
}

async function showNoteForm(note = null) {
    const isEdit = !!note;
    const container = document.getElementById('page-notes');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button type="button" class="btn back-btn" id="backNoteFormBtn">← Back</button>
                <h2 style="margin:0; flex:1; text-align:center;">${isEdit ? 'Edit Note' : 'New Note'}</h2>
                <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
            </div>
            <form id="noteForm">
                <div class="field">
                    <label>Title *</label>
                    <input id="nf-title" required value="${isEdit ? escapeHTML(note.title) : ''}">
                </div>
                <div class="field">
                    <label>Content</label>
                    <textarea id="nf-content" style="min-height:120px">${isEdit ? escapeHTML(note.content) : ''}</textarea>
                </div>
                <div style="margin-top:15px; display:flex; gap:10px;">
                    <button type="submit" class="btn green" style="flex:1;">Save Note</button>
                    <button type="button" class="btn" id="cancelNoteBtn">Cancel</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('backNoteFormBtn').onclick = () => window.appRouter.back();
    document.getElementById('cancelNoteBtn').onclick = () => window.appRouter.back();

    document.getElementById('noteForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            id: isEdit ? note.id : generateId(),
            title: document.getElementById('nf-title').value.trim() || 'Untitled',
            content: document.getElementById('nf-content').value.trim(),
            created: isEdit ? note.created : new Date().toISOString()
        };
        await window.appDB.put('notes', data);
        window.appRouter.isFormDirty = false;
        window.appRouter.navigate('notes');
    };
}