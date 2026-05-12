// Single-page state machine for the task creation flow.
// Screens: pick-project → form → preview → success.
//
// The email-campaign template is hardcoded here for Phase 1. When more
// templates are added it will move to its own module/JSON file.

const TEMPLATE = {
  id: 'email-campaign',
  name: 'Email Campaign',
  tasklistNamePattern: 'SEO. {clientType}. {monthLabel} Email Campaign',
  parentTaskNamePattern: '{monthLabel} Email Campaign',
  defaultTags: [{ id: 81162, name: 'Email' }],
  subtasks: [
    'Develop text for email and share doc for internal review',
    'Tag Andi for review & model image options',
    'Proofread newsletter document & find model image options',
    'Test internally',
    '[Project manager] Check with client for email addresses to add',
    'Send test to practice for approval',
    'Update specials page, add to GBP, & notify Ashley for social clients',
    'Send newsletter during the first week of the month',
    'Send reminder newsletter during the third week of the month; change subject line',
  ],
};

const state = {
  projectMode: 'existing',      // 'existing' (pick from list) | 'new' (create new project on confirm)
  selectedProject: null,        // { id, name } — set after picking (existing) or creating (new). For 'new', id is null until confirm.
  newProjectDraft: null,        // { name, description } — captured before preview when projectMode === 'new'
  existingTasklists: [],        // for the currently selected project
  preview: null,                // { tasklistName, parentTaskName, subtasks, tasklistMode, ... }
};

// ===== screen routing =====

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.dataset.active = el.id === `screen-${id}` ? 'true' : 'false';
  }
  // Subtitle copy varies by step
  const subtitle = document.getElementById('subtitle');
  subtitle.textContent = {
    'pick-project': 'Pick a project to start.',
    'form': 'Fill in the campaign details.',
    'preview': 'Review and edit before pushing to Teamwork.',
    'success': '',
  }[id] ?? '';
}

// ===== screen 1: project picker (existing OR new) =====

const searchInput = document.getElementById('search');
const projectResults = document.getElementById('project-results');
const searchStatus = document.getElementById('search-status');
const modeToggleBtns = document.querySelectorAll('.mode-toggle-btn');
const modePanels = document.querySelectorAll('.mode-panel');
const newProjectForm = document.getElementById('new-project-form');
const newProjectNameInput = document.getElementById('new-project-name');
const newProjectDescInput = document.getElementById('new-project-description');
const tasklistFieldset = document.getElementById('tasklist-fieldset');

function setProjectMode(mode) {
  state.projectMode = mode;
  for (const btn of modeToggleBtns) {
    btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
  }
  for (const panel of modePanels) {
    panel.dataset.active = String(panel.dataset.modePanel === mode);
  }
}

for (const btn of modeToggleBtns) {
  btn.addEventListener('click', () => setProjectMode(btn.dataset.mode));
}

let debounceTimer = null;
let activeProjectsRequestId = 0;

async function loadProjects(term) {
  const requestId = ++activeProjectsRequestId;
  setStatus(searchStatus, term ? `Searching for "${term}"…` : 'Loading projects…');

  const url = new URL('/api/projects', window.location.origin);
  if (term) url.searchParams.set('search', term);

  try {
    const res = await fetch(url);
    if (requestId !== activeProjectsRequestId) return;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(searchStatus, `Error: ${body.error || res.statusText}`, true);
      projectResults.innerHTML = '';
      return;
    }
    const { projects, total } = await res.json();
    renderProjects(projects);
    setStatus(
      searchStatus,
      projects.length === 0 ? 'No projects matched.' : `Showing ${projects.length} of ${total}.`
    );
  } catch (err) {
    if (requestId !== activeProjectsRequestId) return;
    setStatus(searchStatus, `Network error: ${err.message}`, true);
  }
}

function renderProjects(projects) {
  projectResults.innerHTML = '';
  for (const p of projects) {
    const li = document.createElement('li');
    li.dataset.projectId = p.id;
    li.innerHTML = '<span class="project-name"></span><span class="project-id"></span>';
    li.querySelector('.project-name').textContent = p.name;
    li.querySelector('.project-id').textContent = `#${p.id}`;
    li.addEventListener('click', () => selectProject(p));
    projectResults.appendChild(li);
  }
}

searchInput.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  const term = e.target.value.trim();
  debounceTimer = setTimeout(() => loadProjects(term), 200);
});

// ===== screen 2: form =====

const banner = document.getElementById('selected-project-banner');
const monthInput = document.getElementById('month');
const tasklistNameSub = document.getElementById('preview-tasklist-name');
const existingSelect = document.getElementById('existing-tasklist');
const form = document.getElementById('campaign-form');

// Default the month input to the current month.
{
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function selectProject(project) {
  state.projectMode = 'existing';
  state.selectedProject = project;
  state.newProjectDraft = null;
  banner.innerHTML = `Selected project: <b></b> <span class="project-id">#${project.id}</span>`;
  banner.querySelector('b').textContent = project.name;
  tasklistFieldset.hidden = false;
  // Restore default tasklist mode (the radio markup defaults to "new")
  loadExistingTasklists(project.id);
  updateTasklistPreview();
  showScreen('form');
}

newProjectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = newProjectNameInput.value.trim();
  if (!name) return;
  state.projectMode = 'new';
  state.newProjectDraft = {
    name,
    description: newProjectDescInput.value.trim(),
  };
  // The project doesn't exist in Teamwork yet — show its draft name as
  // the selected project. Final id is assigned at confirm time.
  state.selectedProject = { id: null, name };
  state.existingTasklists = [];
  banner.innerHTML = `Creating new project: <b></b> <span class="project-id">(new)</span>`;
  banner.querySelector('b').textContent = name;
  // No existing tasklists are possible inside a brand-new project — hide
  // the whole tasklist-mode chooser; we always create a new tasklist.
  tasklistFieldset.hidden = true;
  // Force tasklistMode = "new" so updateTasklistPreview / form submit
  // pick up the right value even though the radios are hidden.
  const newRadio = form.querySelector('input[name="tasklistMode"][value="new"]');
  if (newRadio) newRadio.checked = true;
  updateTasklistPreview();
  showScreen('form');
});

async function loadExistingTasklists(projectId) {
  existingSelect.disabled = true;
  existingSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await fetch(`/api/projects/${projectId}/tasklists`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { tasklists } = await res.json();
    state.existingTasklists = tasklists;
    existingSelect.innerHTML = '';
    if (tasklists.length === 0) {
      existingSelect.innerHTML = '<option value="">No existing tasklists</option>';
      return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— select an existing tasklist —';
    existingSelect.appendChild(placeholder);
    for (const tl of tasklists) {
      const opt = document.createElement('option');
      opt.value = tl.id;
      opt.textContent = tl.name;
      existingSelect.appendChild(opt);
    }
    existingSelect.disabled = false;
  } catch (err) {
    existingSelect.innerHTML = `<option value="">Failed to load: ${err.message}</option>`;
  }
}

function fillPattern(pattern, vars) {
  return pattern.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function formatMonthLabel(monthValue) {
  if (!monthValue) return '';
  const [year, month] = monthValue.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function currentFormVars() {
  const clientType = form.querySelector('input[name="clientType"]:checked').value;
  const monthLabel = formatMonthLabel(monthInput.value);
  return { clientType, monthLabel };
}

function updateTasklistPreview() {
  const vars = currentFormVars();
  tasklistNameSub.textContent = fillPattern(TEMPLATE.tasklistNamePattern, vars);
}

// React to form changes that affect the preview name
form.addEventListener('change', updateTasklistPreview);
monthInput.addEventListener('input', updateTasklistPreview);

// Enable/disable existing-tasklist dropdown based on mode
form.addEventListener('change', (e) => {
  if (e.target.name === 'tasklistMode') {
    const useExisting = e.target.value === 'existing';
    existingSelect.disabled = !useExisting || state.existingTasklists.length === 0;
  }
});

document.getElementById('back-to-projects').addEventListener('click', () => {
  showScreen('pick-project');
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const vars = currentFormVars();
  // When creating a new project, there's nothing existing to pick from —
  // force tasklist mode to "new" regardless of which radio is checked.
  const tlMode =
    state.projectMode === 'new'
      ? 'new'
      : form.querySelector('input[name="tasklistMode"]:checked').value;

  if (tlMode === 'existing' && !existingSelect.value) {
    alert('Pick an existing tasklist or switch to "Create new".');
    return;
  }

  state.preview = {
    projectMode: state.projectMode,
    newProject: state.projectMode === 'new' ? { ...state.newProjectDraft } : null,
    tasklistMode: tlMode,
    tasklistName: fillPattern(TEMPLATE.tasklistNamePattern, vars),
    existingTasklistId: tlMode === 'existing' ? Number(existingSelect.value) : null,
    existingTasklistName:
      tlMode === 'existing'
        ? state.existingTasklists.find((tl) => tl.id === Number(existingSelect.value))?.name
        : null,
    parentTaskName: fillPattern(TEMPLATE.parentTaskNamePattern, vars),
    subtasks: [...TEMPLATE.subtasks],
    tags: TEMPLATE.defaultTags,
    notes: document.getElementById('notes').value.trim(),
  };

  renderPreview();
  showScreen('preview');
});

// ===== screen 3: preview =====

const previewProject = document.getElementById('preview-project');
const previewTasklist = document.getElementById('preview-tasklist');
const previewParentTask = document.getElementById('preview-parent-task');
const previewSubtasks = document.getElementById('preview-subtasks');
const previewStatus = document.getElementById('preview-status');
const previewNewProjectRow = document.getElementById('preview-new-project-row');
const previewNewProject = document.getElementById('preview-new-project');
const confirmBtn = document.getElementById('confirm-create');

function renderPreview() {
  const p = state.preview;
  if (p.projectMode === 'new') {
    previewNewProjectRow.hidden = false;
    const desc = p.newProject.description
      ? ` — ${p.newProject.description}`
      : '';
    previewNewProject.textContent = `${p.newProject.name}  (new)${desc}`;
    previewProject.textContent = '(will be created above)';
  } else {
    previewNewProjectRow.hidden = true;
    previewProject.textContent = `${state.selectedProject.name} #${state.selectedProject.id}`;
  }
  previewTasklist.textContent =
    p.tasklistMode === 'new'
      ? `${p.tasklistName}  (new)`
      : `${p.existingTasklistName}  (existing)`;
  previewParentTask.value = p.parentTaskName;

  previewSubtasks.innerHTML = '';
  p.subtasks.forEach((text, idx) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'subtask-input';
    input.value = text;
    input.dataset.index = String(idx);
    input.addEventListener('input', () => {
      state.preview.subtasks[Number(input.dataset.index)] = input.value;
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.title = 'Remove subtask';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.preview.subtasks.splice(Number(input.dataset.index), 1);
      renderPreview();
    });
    li.appendChild(input);
    li.appendChild(remove);
    previewSubtasks.appendChild(li);
  });

  setStatus(previewStatus, '');
}

previewParentTask.addEventListener('input', () => {
  state.preview.parentTaskName = previewParentTask.value;
});

document.getElementById('back-to-form').addEventListener('click', () => {
  showScreen('form');
});

confirmBtn.addEventListener('click', async () => {
  const p = state.preview;
  // Trim empties and re-validate
  p.subtasks = p.subtasks.map((s) => s.trim()).filter(Boolean);
  if (p.subtasks.length === 0) {
    setStatus(previewStatus, 'Add at least one subtask before creating.', true);
    return;
  }
  if (!p.parentTaskName.trim()) {
    setStatus(previewStatus, 'Parent task name cannot be empty.', true);
    return;
  }

  confirmBtn.disabled = true;

  // Step A — create the Teamwork project, if this is "new project" mode.
  // Done as a separate request so the existing /api/create flow stays
  // untouched. If project creation fails, nothing downstream happens.
  let createdProject = null;
  if (p.projectMode === 'new') {
    setStatus(previewStatus, `Creating project "${p.newProject.name}"…`);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.newProject),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatus(previewStatus, `Error creating project: ${result.error || res.statusText}`, true);
        confirmBtn.disabled = false;
        return;
      }
      createdProject = result; // { id, name, url }
      state.selectedProject = { id: result.id, name: result.name };
    } catch (err) {
      setStatus(previewStatus, `Network error creating project: ${err.message}`, true);
      confirmBtn.disabled = false;
      return;
    }
  }

  // Step B — create tasklist + parent task + subtasks (existing flow, unchanged).
  setStatus(previewStatus, 'Creating tasklist, parent task, and subtasks…');

  const payload = {
    tasklistMode: p.tasklistMode,
    parentTaskName: p.parentTaskName.trim(),
    subtasks: p.subtasks,
    tags: p.tags,
  };
  if (p.tasklistMode === 'new') {
    payload.projectId = state.selectedProject.id;
    payload.tasklistName = p.tasklistName;
  } else {
    payload.tasklistId = p.existingTasklistId;
  }

  try {
    const res = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) {
      const projectNote = createdProject
        ? ` (project "${createdProject.name}" was created — open it: ${createdProject.url})`
        : '';
      setStatus(previewStatus, `Error: ${result.error || res.statusText}${projectNote}`, true);
      confirmBtn.disabled = false;
      return;
    }
    renderSuccess(result, createdProject);
    showScreen('success');
  } catch (err) {
    setStatus(previewStatus, `Network error: ${err.message}`, true);
    confirmBtn.disabled = false;
  }
});

// ===== screen 4: success =====

const successSummary = document.getElementById('success-summary');
const successPartial = document.getElementById('success-partial');
const successLink = document.getElementById('success-link');
const successProjectLink = document.getElementById('success-project-link');

function renderSuccess(result, createdProject) {
  const subtaskCount = result.subtaskIds?.length ?? 0;
  const prefix = createdProject
    ? `Created project “${createdProject.name}”, plus 1 parent task and ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}.`
    : `Created 1 parent task and ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'} in “${state.selectedProject.name}”.`;
  successSummary.textContent = prefix;
  if (result.partial) {
    const lines = result.errors.map((e) => `• ${e.subtask}: ${e.error}`).join('\n');
    successPartial.textContent = `Some subtasks failed:\n${lines}`;
  } else {
    successPartial.textContent = '';
  }
  successLink.href = result.tasklistUrl;
  if (createdProject?.url) {
    successProjectLink.href = createdProject.url;
    successProjectLink.hidden = false;
  } else {
    successProjectLink.hidden = true;
  }
}

document.getElementById('start-over').addEventListener('click', () => {
  // Reset to project picker; keep project results loaded
  state.preview = null;
  state.newProjectDraft = null;
  state.selectedProject = null;
  document.getElementById('notes').value = '';
  newProjectNameInput.value = '';
  newProjectDescInput.value = '';
  confirmBtn.disabled = false;
  setProjectMode('existing');
  showScreen('pick-project');
});

// ===== shared helpers =====

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.toggle('working', !isError && !!text);
}

// ===== boot =====

loadProjects('');
updateTasklistPreview();
