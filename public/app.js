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
  selectedProject: null,        // { id, name }
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

// ===== screen 1: project picker =====

const searchInput = document.getElementById('search');
const projectResults = document.getElementById('project-results');
const searchStatus = document.getElementById('search-status');

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
  state.selectedProject = project;
  banner.innerHTML = `Selected project: <b></b> <span class="project-id">#${project.id}</span>`;
  banner.querySelector('b').textContent = project.name;
  loadExistingTasklists(project.id);
  updateTasklistPreview();
  showScreen('form');
}

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
  const mode = form.querySelector('input[name="tasklistMode"]:checked').value;

  if (mode === 'existing' && !existingSelect.value) {
    alert('Pick an existing tasklist or switch to "Create new".');
    return;
  }

  state.preview = {
    tasklistMode: mode,
    tasklistName: fillPattern(TEMPLATE.tasklistNamePattern, vars),
    existingTasklistId: mode === 'existing' ? Number(existingSelect.value) : null,
    existingTasklistName:
      mode === 'existing'
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
const confirmBtn = document.getElementById('confirm-create');

function renderPreview() {
  const p = state.preview;
  previewProject.textContent = `${state.selectedProject.name} #${state.selectedProject.id}`;
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
      setStatus(previewStatus, `Error: ${result.error || res.statusText}`, true);
      confirmBtn.disabled = false;
      return;
    }
    renderSuccess(result);
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

function renderSuccess(result) {
  const subtaskCount = result.subtaskIds?.length ?? 0;
  successSummary.textContent =
    `Created 1 parent task and ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'} in “${state.selectedProject.name}”.`;
  if (result.partial) {
    const lines = result.errors.map((e) => `• ${e.subtask}: ${e.error}`).join('\n');
    successPartial.textContent = `Some subtasks failed:\n${lines}`;
  } else {
    successPartial.textContent = '';
  }
  successLink.href = result.tasklistUrl;
}

document.getElementById('start-over').addEventListener('click', () => {
  // Reset to project picker; keep project results loaded
  state.preview = null;
  document.getElementById('notes').value = '';
  confirmBtn.disabled = false;
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
