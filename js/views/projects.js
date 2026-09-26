// Projects View
window.appRouter.addRoute('projects', async () => {
    const container = document.getElementById('page-projects');
    if(!container) {
        const main = document.querySelector('main');
        const p = document.createElement('section');
        p.id = 'page-projects'; p.className = 'page';
        main.appendChild(p);
    }

    document.getElementById('page-projects').innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">Projects</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <input class="search" id="projectSearch" placeholder="Search projects...">
                <button class="btn primary" id="newProjectBtn">+ New Project</button>
            </div>
            <div id="projectList">Loading...</div>
        </div>
    `;

    let projects = await window.appDB.getAll('projects');

    // Resolve client names (optimized: avoid N+1 queries)
    const clients = await window.appDB.getAll('clients');
    const clientMap = new Map(clients.map(c => [c.id, c.name]));
    for (let p of projects) {
        if (p.clientId && clientMap.has(p.clientId)) {
            p.clientNameTemp = clientMap.get(p.clientId);
        }
    }

    const renderProjects = (filter = "") => {
        const list = projects.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || (p.clientNameTemp || "").toLowerCase().includes(filter.toLowerCase()));
        const listContainer = document.getElementById('projectList');

        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty">No projects found.</div>';
            return;
        }

        listContainer.innerHTML = list.sort((a,b) => new Date(b.deadline) - new Date(a.deadline)).map(p => `
            <div class="list-item">
                <div class="list-item-head">
                    <div>
                        <div class="list-item-title">${escapeHTML(p.name)}</div>
                        <div class="list-item-meta">${escapeHTML(p.clientNameTemp || "No Client")} • Due: ${escapeHTML(p.deadline)}</div>
                    </div>
                    <span style="font-size:12px; font-weight:700; padding:4px 8px; border-radius:8px; background:var(--bg); color:var(--text)">
                        ${escapeHTML(p.status)}
                    </span>
                </div>

                <div style="margin-top:12px; height:6px; background:var(--line); border-radius:3px; overflow:hidden;">
                    <div style="height:100%; width:${p.progress || 0}%; background:var(--green); border-radius:3px;"></div>
                </div>

                <div class="list-item-actions">
                    <button class="btn small" data-view-project="${p.id}">View Details</button>
                    <button class="btn small" data-edit-project="${p.id}">Edit</button>
                    <button class="btn small danger" data-delete-project="${p.id}">Delete</button>
                </div>
            </div>
        `).join('');
    };

    renderProjects();

    document.getElementById('projectSearch').addEventListener('input', (e) => {
        renderProjects(e.target.value);
    });

    document.getElementById('newProjectBtn').onclick = () => showProjectForm();

    document.getElementById('projectList').onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.editProject) {
            const p = await window.appDB.get('projects', btn.dataset.editProject);
            showProjectForm(p);
        } else if (btn.dataset.deleteProject) {
            if (await window.showConfirm("Delete this project? Associated tasks will be orphaned.")) {
                await window.appDB.delete('projects', btn.dataset.deleteProject);
                projects = await window.appDB.getAll('projects');
                renderProjects();
            }
        } else if (btn.dataset.viewProject) {
            showProjectDetails(btn.dataset.viewProject);
        }
    };
});

async function showProjectForm(project = null) {
    const isEdit = !!project;
    const container = document.getElementById('page-projects');
    const clients = await window.appDB.getAll('clients');

    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Project' : 'New Project'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelProjectBtn">Cancel</button>
            </div>
            <form id="projectForm">
                <div class="field">
                    <label>Project Name *</label>
                    <input id="pf-name" required value="${isEdit ? escapeHTML(project.name) : ''}">
                </div>
                <div class="row">
                    <div class="field">
                        <label>Client</label>
                        <select id="pf-client">
                            <option value="">No Client</option>
                            ${clients.map(c => `<option value="${c.id}" ${isEdit && project.clientId === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field">
                        <label>Status</label>
                        <select id="pf-status">
                            <option ${isEdit && project.status === 'Planning' ? 'selected' : ''}>Planning</option>
                            <option ${isEdit && project.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                            <option ${isEdit && project.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
                            <option ${isEdit && project.status === 'Completed' ? 'selected' : ''}>Completed</option>
                            <option ${isEdit && project.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </div>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Start Date</label>
                        <input type="date" id="pf-start" value="${isEdit ? project.startDate : getTodayDate()}">
                    </div>
                    <div class="field">
                        <label>Deadline</label>
                        <input type="date" id="pf-deadline" value="${isEdit ? project.deadline : ''}">
                    </div>
                </div>
                <div class="row">
                    <div class="field">
                        <label>Budget</label>
                        <input type="number" id="pf-budget" step="0.01" value="${isEdit ? project.budget : ''}">
                    </div>
                    <div class="field">
                        <label>Progress (%)</label>
                        <input type="number" id="pf-progress" min="0" max="100" value="${isEdit ? project.progress : '0'}">
                    </div>
                </div>
                <div class="field">
                    <label>Description</label>
                    <textarea id="pf-desc">${isEdit ? escapeHTML(project.description) : ''}</textarea>
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Project</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelProjectBtn').onclick = () => window.appRouter.navigate('projects');

    document.getElementById('projectForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            id: isEdit ? project.id : generateId(),
            name: document.getElementById('pf-name').value.trim(),
            clientId: document.getElementById('pf-client').value,
            status: document.getElementById('pf-status').value,
            startDate: document.getElementById('pf-start').value,
            deadline: document.getElementById('pf-deadline').value,
            budget: Number(document.getElementById('pf-budget').value) || 0,
            progress: Number(document.getElementById('pf-progress').value) || 0,
            description: document.getElementById('pf-desc').value.trim()
        };
        await window.appDB.put('projects', data);
        window.appRouter.navigate('projects');
    };
}

async function showProjectDetails(projectId) {
    const project = await window.appDB.get('projects', projectId);
    if (!project) return window.appRouter.navigate('projects');

    let clientName = "No Client";
    if (project.clientId) {
        const c = await window.appDB.get('clients', project.clientId);
        if (c) clientName = c.name;
    }

    // Get Tasks
    const allTasks = await window.appDB.getByIndex('tasks', 'projectId', projectId);

    const container = document.getElementById('page-projects');
    container.innerHTML = `
        <div class="card" style="margin-bottom:15px">
            <div class="toolbar">
                <button class="btn" id="backToProjects">← Back</button>
                <button class="btn primary" id="editProjBtn">Edit Project</button>
            </div>
            <div style="margin-top: 15px; margin-bottom: 25px;">
                <h1 style="margin-bottom: 4px;">${escapeHTML(project.name)}</h1>
                <div class="subtitle" style="font-size:14px">${escapeHTML(clientName)}</div>
                <div style="margin-top:10px; font-size:13px;">
                    <strong>Status:</strong> ${project.status} |
                    <strong>Deadline:</strong> ${project.deadline || 'None'} |
                    <strong>Budget:</strong> ${formatMoney(project.budget, window.AppState.settings.currency)}
                </div>

                <div style="margin-top:15px">
                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-bottom:4px;">
                        <span>Progress</span><span>${project.progress || 0}%</span>
                    </div>
                    <div style="height:8px; background:var(--line); border-radius:4px; overflow:hidden;">
                        <div style="height:100%; width:${project.progress || 0}%; background:var(--green); border-radius:4px;"></div>
                    </div>
                </div>
            </div>

            ${project.description ? `
            <div style="padding: 15px; background: var(--bg); border-radius: 12px;">
                <h3 style="margin-top:0">Description</h3>
                <p style="margin:0; font-size:14px; white-space:pre-wrap">${escapeHTML(project.description)}</p>
            </div>` : ''}
        </div>

        <div class="card">
            <div class="toolbar">
                <h3 style="margin:0">Tasks</h3>
            </div>
            <div id="inlineAddTaskForm" style="display:flex; gap:8px; margin-bottom:15px;">
                <input id="projNewTaskTitle" placeholder="Enter task title..." style="flex:1;">
                <button class="btn primary small" id="projAddBtn">+ Add Task</button>
            </div>
            <div id="projTaskList"></div>
        </div>
    `;

    document.getElementById('backToProjects').onclick = () => window.appRouter.navigate('projects');
    document.getElementById('editProjBtn').onclick = () => showProjectForm(project);

    const renderTasks = () => {
        const list = document.getElementById('projTaskList');
        if (allTasks.length === 0) {
            list.innerHTML = '<div class="muted" style="font-size:13px">No tasks for this project.</div>';
            return;
        }
        list.innerHTML = allTasks.map(t => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--line);">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <input type="checkbox" style="width:auto; transform:scale(1.2)" data-toggle-task="${t.id}" ${t.status === 'Completed' ? 'checked' : ''}>
                    <div style="${t.status === 'Completed' ? 'text-decoration:line-through; color:var(--muted)' : ''}">
                        <div style="font-weight:bold; font-size:14px;">${escapeHTML(t.title)}</div>
                        ${t.dueDate ? `<div style="font-size:11px; color:var(--orange)">Due: ${escapeHTML(t.dueDate)}</div>` : ''}
                    </div>
                </div>
                <button class="btn small danger" data-del-task="${t.id}">X</button>
            </div>
        `).join('');
    };
    renderTasks();

    document.getElementById('projAddBtn').onclick = async () => {
        const input = document.getElementById('projNewTaskTitle');
        const title = input.value.trim();
        if (title) {
            const task = {
                id: generateId(),
                projectId: project.id,
                clientId: project.clientId,
                title: title,
                status: 'Pending',
                dueDate: ''
            };
            await window.appDB.put('tasks', task);
            allTasks.push(task);
            input.value = '';
            renderTasks();
        }
    };

    document.getElementById('projTaskList').addEventListener('change', async (e) => {
        if (e.target.dataset.toggleTask) {
            const taskId = e.target.dataset.toggleTask;
            const task = allTasks.find(t => t.id === taskId);
            if (task) {
                task.status = e.target.checked ? 'Completed' : 'Pending';
                await window.appDB.put('tasks', task);
                renderTasks();
            }
        }
    });

    document.getElementById('projTaskList').addEventListener('click', async (e) => {
        if (e.target.dataset.delTask) {
            if (await window.showConfirm("Delete this task?")) {
                const taskId = e.target.dataset.delTask;
                await window.appDB.delete('tasks', taskId);
                const index = allTasks.findIndex(t => t.id === taskId);
                if (index > -1) allTasks.splice(index, 1);
                renderTasks();
            }
        }
    });
}

// Global Tasks View
window.appRouter.addRoute('tasks', async () => {
    const container = document.getElementById('page-tasks');
    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">My Tasks</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn primary" id="globalNewTaskBtn">+ New Task</button>
            </div>

            <div class="tabs" style="margin-bottom: 15px;">
                <button class="tab active" data-filter="pending">Pending</button>
                <button class="tab" data-filter="completed">Completed</button>
            </div>

            <div id="globalTaskList">Loading...</div>
        </div>
    `;

    const tasks = await window.appDB.getAll('tasks');
    const projects = await window.appDB.getAll('projects');

    // Pre-map project names
    const projMap = {};
    projects.forEach(p => projMap[p.id] = p.name);

    let currentFilter = 'pending';

    const renderTasks = () => {
        const filtered = tasks.filter(t => currentFilter === 'pending' ? t.status !== 'Completed' : t.status === 'Completed');
        const list = document.getElementById('globalTaskList');

        if (filtered.length === 0) {
            list.innerHTML = `<div class="empty">No ${currentFilter} tasks.</div>`;
            return;
        }

        // Sort: pending by nearest date, completed by newest
        filtered.sort((a,b) => {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

        list.innerHTML = filtered.map(t => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="display:flex; gap:12px; flex:1;">
                    <input type="checkbox" style="width:auto; margin-top:4px; transform:scale(1.2)" data-global-toggle="${t.id}" ${t.status === 'Completed' ? 'checked' : ''}>
                    <div style="${t.status === 'Completed' ? 'text-decoration:line-through; color:var(--muted)' : ''}">
                        <div style="font-weight:bold; font-size:15px;">${escapeHTML(t.title)}</div>
                        <div style="font-size:12px; color:var(--muted); margin-top:2px;">
                            ${t.projectId ? `📁 ${escapeHTML(projMap[t.projectId] || 'Unknown')}` : 'General'}
                        </div>
                        ${t.dueDate ? `<div style="font-size:11px; margin-top:4px; color:${t.status !== 'Completed' && new Date(t.dueDate) < new Date() ? 'var(--red)' : 'var(--orange)'}">Due: ${escapeHTML(t.dueDate)}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:5px; flex-direction:column;">
                    <button class="btn small" data-global-edit="${t.id}">Edit</button>
                    <button class="btn small danger" data-global-del="${t.id}">X</button>
                </div>
            </div>
        `).join('');
    };

    renderTasks();

    // Tab switching
    container.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTasks();
        };
    });

    document.getElementById('globalNewTaskBtn').onclick = () => showTaskForm(null, projects);

    document.getElementById('globalTaskList').addEventListener('change', async (e) => {
        if (e.target.dataset.globalToggle) {
            const taskId = e.target.dataset.globalToggle;
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                task.status = e.target.checked ? 'Completed' : 'Pending';
                await window.appDB.put('tasks', task);
                renderTasks(); // moves it out of current view
            }
        }
    });

    document.getElementById('globalTaskList').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.globalDel) {
            if (await window.showConfirm("Delete this task?")) {
                await window.appDB.delete('tasks', btn.dataset.globalDel);
                const index = tasks.findIndex(t => t.id === btn.dataset.globalDel);
                if (index > -1) tasks.splice(index, 1);
                renderTasks();
            }
        } else if (btn.dataset.globalEdit) {
            const task = tasks.find(t => t.id === btn.dataset.globalEdit);
            if (task) showTaskForm(task, projects);
        }
    });
});

function showTaskForm(task, projects) {
    const isEdit = !!task;
    const container = document.getElementById('page-tasks');

    container.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <h2 style="margin:0">${isEdit ? 'Edit Task' : 'New Task'}</h2>
            <button class="icon-btn global-filter-btn" title="Filter by Date">📅</button>
                <button class="btn" id="cancelTaskBtn">Cancel</button>
            </div>
            <form id="taskForm">
                <div class="field">
                    <label>Task Title *</label>
                    <input id="tf-title" required value="${isEdit ? escapeHTML(task.title) : ''}">
                </div>
                <div class="row">
                    <div class="field">
                        <label>Project Link</label>
                        <select id="tf-project">
                            <option value="">None (General Task)</option>
                            ${projects.map(p => `<option value="${p.id}" ${isEdit && task.projectId === p.id ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field">
                        <label>Due Date</label>
                        <input type="date" id="tf-due" value="${isEdit ? task.dueDate : ''}">
                    </div>
                </div>
                <div class="field">
                    <label>Status</label>
                    <select id="tf-status">
                        <option value="Pending" ${isEdit && task.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="Completed" ${isEdit && task.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
                <div class="field">
                    <label>Notes</label>
                    <textarea id="tf-notes">${isEdit ? escapeHTML(task.notes || '') : ''}</textarea>
                </div>
                <div style="margin-top:15px">
                    <button type="submit" class="btn green">Save Task</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('cancelTaskBtn').onclick = () => window.appRouter.navigate('tasks');

    document.getElementById('taskForm').onsubmit = async (e) => {
        e.preventDefault();

        const projectId = document.getElementById('tf-project').value;
        let clientId = "";
        if (projectId) {
            const p = projects.find(x => x.id === projectId);
            if (p) clientId = p.clientId;
        }

        const data = {
            id: isEdit ? task.id : generateId(),
            title: document.getElementById('tf-title').value.trim(),
            projectId: projectId,
            clientId: clientId,
            dueDate: document.getElementById('tf-due').value,
            status: document.getElementById('tf-status').value,
            notes: document.getElementById('tf-notes').value.trim()
        };
        await window.appDB.put('tasks', data);
        window.appRouter.navigate('tasks');
    };
}