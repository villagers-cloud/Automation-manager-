// Team View
window.appRouter.addRoute('team', async () => {
    const container = document.getElementById('page-team');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Team</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newTeamBtn">+ Add Member</button>
            </div>
            <div id="teamList">Loading...</div>
        </div>
    `;

    let team = await window.appDB.getAll('team');

    const renderTeam = () => {
        const list = document.getElementById('teamList');
        if (team.length === 0) {
            list.innerHTML = '<div class="empty">No team members added.</div>';
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

    document.getElementById('newTeamBtn').onclick = () => showTeamForm();

    document.getElementById('teamList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editTeam) {
            const member = await window.appDB.get('team', btn.dataset.editTeam);
            showTeamForm(member);
        } else if (btn.dataset.delTeam) {
            if (confirm('Delete this team member?')) {
                await window.appDB.delete('team', btn.dataset.delTeam);
                team = await window.appDB.getAll('team');
                renderTeam();
            }
        }
    };
});

function showTeamForm(member = null) {
    const isEdit = !!member;
    const container = document.getElementById('page-team');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Member' : 'New Member'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelTeamBtn">Cancel</button>
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
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Member</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelTeamBtn').onclick = () => window.appRouter.navigate('team');
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
        window.appRouter.navigate('team');
    };
}

// Notes View
window.appRouter.addRoute('notes', async () => {
    const container = document.getElementById('page-notes');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Global Notes</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="newNoteBtn">+ New Note</button>
            </div>
            <div id="noteList">Loading...</div>
        </div>
    `;

    let notes = await window.appDB.getAll('notes');

    const renderNotes = () => {
        const list = document.getElementById('noteList');
        if (notes.length === 0) {
            list.innerHTML = '<div class="empty">No notes.</div>';
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
                    <button class="btn small danger" data-del-note="${n.id}">X</button>
                </div>
            </div>
        `).join('');
    };

    renderNotes();

    document.getElementById('newNoteBtn').onclick = () => {
        const title = prompt("Note Title:");
        if (!title) return;
        const content = prompt("Note Content:");
        if (content !== null) {
            window.appDB.put('notes', {
                id: generateId(),
                title: title.trim() || 'Untitled',
                content: content.trim(),
                created: new Date().toISOString()
            }).then(() => {
                window.appRouter.navigate('notes');
            });
        }
    };

    document.getElementById('noteList').onclick = async (e) => {
        if (e.target.dataset.delNote) {
            if (confirm("Delete this note?")) {
                await window.appDB.delete('notes', e.target.dataset.delNote);
                notes = await window.appDB.getAll('notes');
                renderNotes();
            }
        }
    };
});