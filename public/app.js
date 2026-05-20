// Single-page state machine for the task creation flow.
// Screens: pick-project → form → preview → success.
//
// The email-campaign template is hardcoded here for Phase 1. When more
// templates are added it will move to its own module/JSON file.

const TEMPLATES = [
  {
    id: 'ai-generate',
    name: 'AI Generate',
    // Names and subtasks are produced by the AI — no patterns here.
    tasklistNamePattern: null,
    parentTaskNamePattern: null,
    defaultTags: [],
    subtasks: null,
  },
  {
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
  },
  {
    id: 'seo-blog-content',
    name: 'SEO Blog Content',
    tasklistNamePattern: 'SEO. {clientType}. {monthLabel} SEO Blog Content',
    parentTaskNamePattern: '[Copywriter] SEO. {clientType}. {monthLabel} SEO Blog Content',
    defaultTags: [{ id: 62460, name: 'Copywriting' }],
    subtasks: [
      '[Copywriter] Write the blog post using template, tag Madison for image options, and comment for internal review.',
      '[Copywriter] Are there any images we can include?',
      'Choose, prep, & upload blog image with appropriate title. Make sure all caption and stock photo file data has been removed.',
      'Send the internally approved blog post to client for approval. CC PM in email to the practice.',
      'Once we have final approval of all edits, draft the post, adding all metadata, one category, and all the tags. Ensure pull quote has been added & formatted correctly. Follow hub-style guidelines for appropriate blogs. Do not publish more than one post in a 24-hour period.',
      'Post the blog post to GMB.',
      'If this month\'s SEO content is a page update, run page through POP, update as needed, and notify Project & Content Manager',
    ],
  },
];

const state = {
  projectMode: 'existing',      // 'existing' (pick from list) | 'new' (create new project on confirm)
  selectedProject: null,        // { id, name } — set after picking (existing) or creating (new). For 'new', id is null until confirm.
  newProjectDraft: null,        // { name, description } — captured before preview when projectMode === 'new'
  existingTasklists: [],        // for the currently selected project
  preview: null,                // { tasklistName, parentTaskName, subtasks, tasklistMode, ... }
  selectedTemplate: TEMPLATES[0],
};

// ===== screen routing =====

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.dataset.active = el.id === `screen-${id}` ? 'true' : 'false';
  }
  const subtitleMap = {
    'pick-project': 'Pick a project to start.',
    'form': 'Fill in the campaign details.',
    'preview': 'Review and edit before creating tasks.',
    'success': '',
  };
  const titleMap = {
    'pick-project': 'Task Builder — Pick Project',
    'form': 'Task Builder — Configure',
    'preview': 'Task Builder — Preview',
    'success': 'Task Builder — Done',
  };
  const stepMap = { 'pick-project': 1, 'form': 2, 'preview': 3, 'success': 4 };
  const currentStep = stepMap[id] ?? 1;
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    const step = i + 1;
    if (step === currentStep) dot.dataset.state = 'active';
    else if (step < currentStep) dot.dataset.state = 'done';
    else delete dot.dataset.state;
  });
  document.getElementById('subtitle').textContent = subtitleMap[id] ?? '';
  document.title = titleMap[id] ?? 'Task Builder';
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
  btn.addEventListener('keydown', (e) => {
    const buttons = [...modeToggleBtns];
    const i = buttons.indexOf(btn);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
      next.focus();
      setProjectMode(next.dataset.mode);
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0].focus();
      setProjectMode(buttons[0].dataset.mode);
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1].focus();
      setProjectMode(buttons[buttons.length - 1].dataset.mode);
    }
  });
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
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.innerHTML = '<span class="project-name"></span><span class="project-id"></span>';
    li.querySelector('.project-name').textContent = p.name;
    li.querySelector('.project-id').textContent = `#${p.id}`;
    li.addEventListener('click', () => selectProject(p));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProject(p); }
    });
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
  // The project doesn't exist yet — show its draft name as
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
  let result = pattern.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
  // Collapse ". . " segments that result from an empty substitution (e.g. "SEO. . May" → "SEO. May")
  result = result.replace(/\.\s+\./g, '.').trim();
  return result;
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

const standardFields = document.getElementById('standard-fields');
const aiGeneratePanel = document.getElementById('ai-generate-panel');
const aiGeneratePrompt = document.getElementById('ai-generate-prompt');
const aiGenerateStatus = document.getElementById('ai-generate-status');
const templatePicker = document.getElementById('template-picker');

function setAiGenerateMode(isAi) {
  standardFields.hidden = isAi;
  aiGeneratePanel.hidden = !isAi;
  templatePicker.hidden = isAi;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = isAi ? 'Generate preview →' : 'Preview tasks →';
  if (isAi) tasklistNameSub.textContent = '(AI will generate)';
  const hint = document.getElementById('client-type-hint');
  if (hint) {
    hint.textContent = isAi
      ? 'Passed to the AI to help name the tasklist.'
      : 'Appears in the tasklist name—see preview below.';
  }
}

function updateTasklistPreview() {
  if (state.selectedTemplate.id === 'ai-generate') return;
  const vars = currentFormVars();
  tasklistNameSub.textContent = fillPattern(state.selectedTemplate.tasklistNamePattern, vars);
}

// Task mode and template selection
form.addEventListener('change', (e) => {
  if (e.target.name === 'taskMode') {
    const isAi = e.target.value === 'ai-generate';
    if (isAi) {
      state.selectedTemplate = TEMPLATES[0];
    } else {
      const checkedTemplate = form.querySelector('input[name="template"]:checked');
      state.selectedTemplate = TEMPLATES.find((t) => t.id === (checkedTemplate?.value ?? 'email-campaign')) ?? TEMPLATES[1];
    }
    setAiGenerateMode(isAi);
    updateTasklistPreview();
  }
  if (e.target.name === 'template') {
    state.selectedTemplate = TEMPLATES.find((t) => t.id === e.target.value) ?? TEMPLATES[1];
    updateTasklistPreview();
  }
});

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

// Clicking the nested select auto-selects its parent radio
existingSelect.addEventListener('focus', () => {
  const radio = form.querySelector('input[name="tasklistMode"][value="existing"]');
  if (radio && !radio.checked) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

document.getElementById('back-to-projects').addEventListener('click', () => {
  showScreen('pick-project');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const tlMode =
    state.projectMode === 'new'
      ? 'new'
      : form.querySelector('input[name="tasklistMode"]:checked').value;

  if (tlMode === 'existing' && !existingSelect.value) {
    alert('Pick an existing tasklist or switch to "Create new".');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');

  // ===== AI Generate path =====
  if (state.selectedTemplate.id === 'ai-generate') {
    const description = aiGeneratePrompt.value.trim();
    if (!description) {
      setStatus(aiGenerateStatus, 'Add a description first.', true);
      aiGeneratePrompt.focus();
      return;
    }
    const clientType = form.querySelector('input[name="clientType"]:checked')?.value ?? '';
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Generating…';
    setStatus(aiGenerateStatus, 'Generating your tasklist…');
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'design',
          description,
          projectName: state.selectedProject?.name ?? state.newProjectDraft?.name,
          clientType,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatus(aiGenerateStatus, `Error: ${result.error || res.statusText}`, true);
        return;
      }
      setStatus(aiGenerateStatus, '');
      state.preview = {
        projectMode: state.projectMode,
        newProject: state.projectMode === 'new' ? { ...state.newProjectDraft } : null,
        tasklistMode: tlMode,
        tasklistName: result.tasklistName,
        existingTasklistId: tlMode === 'existing' ? Number(existingSelect.value) : null,
        existingTasklistName:
          tlMode === 'existing'
            ? state.existingTasklists.find((tl) => tl.id === Number(existingSelect.value))?.name
            : null,
        parentTaskName: result.parentTaskName,
        parentTaskDescription: result.parentTaskDescription ?? '',
        subtasks: result.subtasks, // [{ name, description }]
        templateId: 'ai-generate',
        templateName: 'AI Generate',
        tags: [],
        notes: description,
        monthLabel: '',
        clientType,
        aiFallback: false,
      };
      renderPreview();
      showScreen('preview');
    } catch (err) {
      setStatus(aiGenerateStatus, `Error: ${err.message}`, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
    return;
  }

  // ===== Standard template path =====
  const vars = currentFormVars();
  const notes = document.getElementById('notes').value.trim();

  // Run the AI tune pass only when the PM actually wrote notes. Empty notes
  // = no work for the model to do; skip the call and save the round-trip.
  let subtasks = state.selectedTemplate.subtasks.map((name) => ({ name, description: '' }));
  let aiFallback = false;
  if (notes) {
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Tuning subtasks…';
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'tune',
          subtasks: subtasks.map((s) => s.name),
          notes,
          templateName: state.selectedTemplate.name,
          projectName: state.selectedProject?.name ?? state.newProjectDraft?.name,
          monthLabel: vars.monthLabel,
          clientType: vars.clientType,
        }),
      });
      const result = await res.json();
      if (res.ok && Array.isArray(result.subtasks) && result.subtasks.length > 0) {
        subtasks = result.subtasks.map((name) => ({ name, description: '' }));
        aiFallback = !!result.fallback;
      } else {
        aiFallback = true;
      }
    } catch {
      aiFallback = true;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }

  state.preview = {
    projectMode: state.projectMode,
    newProject: state.projectMode === 'new' ? { ...state.newProjectDraft } : null,
    tasklistMode: tlMode,
    tasklistName: fillPattern(state.selectedTemplate.tasklistNamePattern, vars),
    existingTasklistId: tlMode === 'existing' ? Number(existingSelect.value) : null,
    existingTasklistName:
      tlMode === 'existing'
        ? state.existingTasklists.find((tl) => tl.id === Number(existingSelect.value))?.name
        : null,
    parentTaskName: fillPattern(state.selectedTemplate.parentTaskNamePattern, vars),
    parentTaskDescription: '',
    subtasks, // [{ name, description }]
    templateId: state.selectedTemplate.id,
    templateName: state.selectedTemplate.name,
    tags: state.selectedTemplate.defaultTags,
    notes,
    monthLabel: vars.monthLabel,
    clientType: vars.clientType,
    aiFallback,
  };

  renderPreview();
  showScreen('preview');
});

// ===== screen 3: preview =====

const previewProject = document.getElementById('preview-project');
const previewTasklist = document.getElementById('preview-tasklist');
const previewParentTask = document.getElementById('preview-parent-task');
const previewParentDesc = document.getElementById('preview-parent-desc');
const previewSubtasks = document.getElementById('preview-subtasks');
const previewStatus = document.getElementById('preview-status');
const previewNewProjectRow = document.getElementById('preview-new-project-row');
const previewNewProject = document.getElementById('preview-new-project');
const confirmBtn = document.getElementById('confirm-create');

let dragSrcIdx = null;

function autoResize(el) {
  requestAnimationFrame(() => {
    el.style.height = '1px';
    el.style.height = `${el.scrollHeight}px`;
  });
}

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
  previewTasklist.value = p.tasklistMode === 'new' ? p.tasklistName : (p.existingTasklistName ?? '');
  previewTasklist.disabled = p.tasklistMode !== 'new';
  autoResize(previewTasklist);
  previewParentTask.value = p.parentTaskName;
  autoResize(previewParentTask);
  previewParentDesc.value = p.parentTaskDescription ?? '';
  autoResize(previewParentDesc);

  previewSubtasks.innerHTML = '';
  p.subtasks.forEach((subtask, idx) => {
    const li = document.createElement('li');
    li.setAttribute('draggable', 'true');

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'subtask-body';

    const input = document.createElement('textarea');
    input.className = 'subtask-input';
    input.value = subtask.name;
    input.rows = 1;
    input.dataset.index = String(idx);
    input.addEventListener('input', () => {
      state.preview.subtasks[Number(input.dataset.index)].name = input.value;
      autoResize(input);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    const desc = document.createElement('textarea');
    desc.className = 'subtask-desc';
    desc.value = subtask.description ?? '';
    desc.rows = 1;
    desc.placeholder = 'Add a note…';
    desc.dataset.index = String(idx);
    desc.addEventListener('input', () => {
      state.preview.subtasks[Number(desc.dataset.index)].description = desc.value;
      autoResize(desc);
    });
    desc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
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

    li.addEventListener('dragstart', (e) => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => li.classList.add('dragging'), 0);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      previewSubtasks.querySelectorAll('li').forEach((el) => el.classList.remove('drag-over'));
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrcIdx !== idx) {
        previewSubtasks.querySelectorAll('li').forEach((el) => el.classList.remove('drag-over'));
        li.classList.add('drag-over');
      }
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      const [moved] = state.preview.subtasks.splice(dragSrcIdx, 1);
      state.preview.subtasks.splice(idx, 0, moved);
      dragSrcIdx = null;
      renderPreview();
    });

    body.appendChild(input);
    body.appendChild(desc);
    li.appendChild(handle);
    li.appendChild(body);
    li.appendChild(remove);
    previewSubtasks.appendChild(li);
    autoResize(input);
    autoResize(desc);
  });

  if (state.preview.aiFallback) {
    setStatus(
      previewStatus,
      'AI rewording was unavailable — showing default subtasks. You can still edit them or use "Regenerate from description".',
      true
    );
  } else {
    setStatus(previewStatus, '');
  }

  // Confirmation summary line above the actions bar
  const confirmSummary = document.getElementById('confirm-summary');
  if (confirmSummary) {
    const p = state.preview;
    const count = p.subtasks.length;
    const noun = count === 1 ? 'subtask' : 'subtasks';
    const projectName = p.projectMode === 'new'
      ? `${p.newProject.name} (new project)`
      : state.selectedProject.name;
    const tasklistName = p.tasklistMode === 'new'
      ? `${p.tasklistName} (new)`
      : p.existingTasklistName;
    confirmSummary.textContent = `${count} ${noun} → ${projectName} · ${tasklistName}`;
  }
}

previewParentTask.addEventListener('input', () => {
  state.preview.parentTaskName = previewParentTask.value;
  autoResize(previewParentTask);
});
previewParentTask.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});

previewParentDesc.addEventListener('input', () => {
  if (state.preview) state.preview.parentTaskDescription = previewParentDesc.value;
  autoResize(previewParentDesc);
});

previewTasklist.addEventListener('input', () => {
  if (state.preview) state.preview.tasklistName = previewTasklist.value;
  autoResize(previewTasklist);
});
previewTasklist.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});

// ===== regenerate-from-description (AI generate mode) =====

const toggleRegenerateBtn = document.getElementById('toggle-regenerate');
const regeneratePanel = document.getElementById('regenerate-panel');
const regenerateDesc = document.getElementById('regenerate-description');
const regenerateSubmit = document.getElementById('regenerate-submit');
const regenerateCancel = document.getElementById('regenerate-cancel');
const regenerateStatus = document.getElementById('regenerate-status');

function setRegeneratePanelOpen(open) {
  regeneratePanel.hidden = !open;
  toggleRegenerateBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    setStatus(regenerateStatus, '');
    regenerateDesc.focus();
  }
}

toggleRegenerateBtn.addEventListener('click', () => {
  setRegeneratePanelOpen(regeneratePanel.hidden);
});

regenerateCancel.addEventListener('click', () => {
  setRegeneratePanelOpen(false);
});

regenerateSubmit.addEventListener('click', async () => {
  const description = regenerateDesc.value.trim();
  if (!description) {
    setStatus(regenerateStatus, 'Add a short description first.', true);
    return;
  }
  regenerateSubmit.disabled = true;
  regenerateCancel.disabled = true;
  setStatus(regenerateStatus, 'Generating subtasks…');
  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'generate',
        description,
        projectName: state.selectedProject?.name ?? state.newProjectDraft?.name,
        monthLabel: state.preview.monthLabel,
        clientType: state.preview.clientType,
      }),
    });
    const result = await res.json();
    if (!res.ok || !Array.isArray(result.subtasks) || result.subtasks.length === 0) {
      setStatus(regenerateStatus, `Error: ${result.error || res.statusText}`, true);
      return;
    }
    state.preview.subtasks = result.subtasks.map((name) => ({ name, description: '' }));
    state.preview.aiFallback = false;
    renderPreview();
    setRegeneratePanelOpen(false);
    regenerateDesc.value = '';
  } catch (err) {
    setStatus(regenerateStatus, `Network error: ${err.message}`, true);
  } finally {
    regenerateSubmit.disabled = false;
    regenerateCancel.disabled = false;
  }
});

document.getElementById('back-to-form').addEventListener('click', () => {
  showScreen('form');
});

confirmBtn.addEventListener('click', async () => {
  const p = state.preview;
  // Trim and re-validate — subtask names required, descriptions optional
  p.subtasks = p.subtasks
    .map((s) => ({ name: s.name.trim(), description: (s.description ?? '').trim() }))
    .filter((s) => s.name);
  if (p.subtasks.length === 0) {
    setStatus(previewStatus, 'Add at least one subtask before creating.', true);
    return;
  }
  if (!p.parentTaskName.trim()) {
    setStatus(previewStatus, 'Parent task name cannot be empty.', true);
    return;
  }

  confirmBtn.disabled = true;

  // Step A — create the project, if this is "new project" mode.
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
    parentTaskDescription: (p.parentTaskDescription ?? '').trim(),
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
  regenerateDesc.value = '';
  setRegeneratePanelOpen(false);
  confirmBtn.disabled = false;
  state.selectedTemplate = TEMPLATES[0];
  aiGeneratePrompt.value = '';
  setStatus(aiGenerateStatus, '');
  setAiGenerateMode(true);
  const taskModeRadio = form.querySelector('input[name="taskMode"][value="ai-generate"]');
  if (taskModeRadio) taskModeRadio.checked = true;
  const firstTemplateRadio = form.querySelector('input[name="template"][value="email-campaign"]');
  if (firstTemplateRadio) firstTemplateRadio.checked = true;
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
setAiGenerateMode(true);
// Initialize step indicator for the starting screen
showScreen('pick-project');
