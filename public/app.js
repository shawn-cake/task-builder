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
  projectMembers: [],           // [{ id, name }] — loaded when an existing project is selected
  preview: null,                // { tasklistName, parentTaskName, subtasks, tasklistMode, ... }
  batchItems: [],               // [{ description, clientType, assigneeId }] — one per prompt box
  batchPreviews: [],            // array of preview objects, one per batch item
  isBatchMode: false,
  selectedTemplate: TEMPLATES[0],
  pendingGeneration: null,      // AbortController | null — cancelled when user navigates back
};

// ===== screen routing =====

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.dataset.active = el.id === `screen-${id}` ? 'true' : 'false';
  }
  // Lazy-load projects the first time the picker is shown (or on re-entry).
  if (id === 'pick-project') {
    const term = searchInput?.value?.trim() ?? '';
    loadProjects(term);
  }
  const subtitleMap = {
    'form': '',
    'pick-project': 'Pick a project to assign tasks to.',
    'preview': 'Review and edit before creating tasks.',
    'success': '',
  };
  const titleMap = {
    'form': 'Task Builder — Configure',
    'pick-project': 'Task Builder — Pick Project',
    'preview': 'Task Builder — Preview',
    'success': 'Task Builder — Done',
  };
  const stepMap = { 'form': 1, 'pick-project': 2, 'preview': 3, 'success': 4 };
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

// ===== screen 2: project picker (existing OR new) =====

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

// ===== screen 1: configure form =====

// ===== DOM refs =====
const assigneeField = document.getElementById('assignee-field');
const assigneeSelect = document.getElementById('assignee-select');
const assigneeHint = document.getElementById('assignee-hint');
const batchPanel = document.getElementById('batch-panel');
const batchItemsContainer = document.getElementById('batch-items');
const batchAddItemBtn = document.getElementById('batch-add-item');
const batchStatus = document.getElementById('batch-status');

const monthInput = document.getElementById('month');
const tasklistNameSub = document.getElementById('preview-tasklist-name');
const existingSelect = document.getElementById('existing-tasklist');
const form = document.getElementById('campaign-form');
const projectSelectedPanel = document.getElementById('project-selected-panel');
const banner = document.getElementById('selected-project-banner');

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
  projectSelectedPanel.hidden = false;
  tasklistFieldset.hidden = false;
  loadExistingTasklists(project.id);
  loadProjectMembers(project.id);
  assigneeField.hidden = false;
  updateTasklistPreview();
  // Stay on pick-project screen; user clicks Continue →
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
  state.projectMembers = [];
  banner.innerHTML = `Creating new project: <b></b> <span class="project-id">(new)</span>`;
  banner.querySelector('b').textContent = name;
  projectSelectedPanel.hidden = false;
  tasklistFieldset.hidden = true;
  const newRadio = document.querySelector('input[name="tasklistMode"][value="new"]');
  if (newRadio) newRadio.checked = true;
  // Assignee not available for new projects — project doesn't exist yet
  assigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
  assigneeSelect.disabled = true;
  assigneeHint.textContent = 'Assignee can be set after the project is created.';
  assigneeField.hidden = false;
  updateTasklistPreview();
  // Stay on pick-project screen; user clicks Continue →
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

async function loadProjectMembers(projectId) {
  state.projectMembers = [];
  assigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
  assigneeSelect.disabled = true;
  assigneeHint.textContent = 'Loading team members…';
  try {
    const res = await fetch(`/api/projects/${projectId}/members`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { members } = await res.json();
    state.projectMembers = members;
    for (const m of members) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      assigneeSelect.appendChild(opt);
    }
    assigneeSelect.disabled = false;
    assigneeHint.textContent = '';
  } catch (err) {
    assigneeHint.textContent = `Could not load members: ${err.message}`;
  }
  renderBatchItems();
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

const clientTypeFieldset = form.querySelector('fieldset:has(input[name="clientType"])');

function setAiGenerateMode(isAi) {
  standardFields.hidden = isAi;
  aiGeneratePanel.hidden = true; // batch panel replaces it for AI Generate
  batchPanel.hidden = !isAi;
  templatePicker.hidden = isAi;
  // AI Generate: per-item contract type inside each prompt box; templates: global fieldset
  if (clientTypeFieldset) clientTypeFieldset.hidden = isAi;
  assigneeField.hidden = isAi;
  state.isBatchMode = isAi;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = isAi ? 'Generate preview →' : 'Preview tasks →';
  if (isAi) {
    tasklistNameSub.textContent = '(AI will generate)';
    if (state.batchItems.length === 0) addBatchItem();
    renderBatchItems();
  }
}

// ===== batch item management =====

function makeBatchItem() {
  return { description: '', clientType: 'C', assigneeId: null };
}

function addBatchItem() {
  state.batchItems.push(makeBatchItem());
  renderBatchItems();
}

function removeBatchItem(index) {
  state.batchItems.splice(index, 1);
  if (state.batchItems.length === 0) addBatchItem();
  else renderBatchItems();
}

function renderBatchItems() {
  batchItemsContainer.innerHTML = '';
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn && state.isBatchMode) {
    submitBtn.textContent = state.batchItems.length > 1 ? 'Generate previews →' : 'Generate preview →';
  }
  state.batchItems.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'batch-item';
    wrap.dataset.index = idx;

    // Header row — only shown for non-first items so the remove button
    // sits clearly above the textarea instead of overlapping it.
    if (idx > 0) {
      const itemHeader = document.createElement('div');
      itemHeader.className = 'batch-item-header';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'batch-item-remove';
      removeBtn.title = 'Remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeBatchItem(idx));
      itemHeader.appendChild(removeBtn);
      wrap.appendChild(itemHeader);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'batch-item-textarea';
    textarea.rows = 6;
    textarea.placeholder = 'Describe the task, or paste content from an email, meeting notes, etc.';
    textarea.value = item.description;
    textarea.addEventListener('input', () => {
      state.batchItems[idx].description = textarea.value;
    });

    // Contract type radios only — assignee is picked per-card after project selection (step 3)
    const metaRow = document.createElement('div');
    metaRow.className = 'batch-item-meta';

    const ctWrap = document.createElement('div');
    ctWrap.className = 'batch-item-client-type';
    for (const [val, lbl] of [['C', 'Contract'], ['H', 'Hourly'], ['G', 'Gratis'], ['', 'None']]) {
      const radioLabel = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `batchClientType_${idx}`;
      radio.value = val;
      radio.checked = item.clientType === val;
      radio.addEventListener('change', () => { state.batchItems[idx].clientType = val; });
      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(` ${lbl}`));
      ctWrap.appendChild(radioLabel);
    }

    metaRow.appendChild(ctWrap);
    wrap.appendChild(textarea);
    wrap.appendChild(metaRow);
    batchItemsContainer.appendChild(wrap);
  });
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

batchAddItemBtn.addEventListener('click', addBatchItem);

// React to form changes that affect the preview name
form.addEventListener('change', updateTasklistPreview);
monthInput.addEventListener('input', updateTasklistPreview);

// Enable/disable existing-tasklist dropdown based on mode.
// tasklistMode radios are now in project-selected-panel (not inside the form).
document.addEventListener('change', (e) => {
  if (e.target.name === 'tasklistMode') {
    const useExisting = e.target.value === 'existing';
    existingSelect.disabled = !useExisting || state.existingTasklists.length === 0;
  }
});

// Clicking the nested select auto-selects its parent radio
existingSelect.addEventListener('focus', () => {
  const radio = document.querySelector('input[name="tasklistMode"][value="existing"]');
  if (radio && !radio.checked) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

// back-to-configure: pick-project → form
document.getElementById('back-to-configure').addEventListener('click', () => {
  projectSelectedPanel.hidden = true;
  state.selectedProject = null;
  state.projectMembers = [];
  state.existingTasklists = [];
  showScreen('form');
});

// continue-to-preview: pick-project → preview (single-task / template)
document.getElementById('continue-to-preview').addEventListener('click', () => {
  const tlMode = state.projectMode === 'new'
    ? 'new'
    : document.querySelector('input[name="tasklistMode"]:checked')?.value ?? 'new';

  if (tlMode === 'existing' && !existingSelect.value) {
    alert('Pick an existing tasklist or switch to "Create new".');
    return;
  }
  if (!state.preview) return;

  state.preview.projectMode = state.projectMode;
  state.preview.newProject = state.projectMode === 'new' ? { ...state.newProjectDraft } : null;
  state.preview.tasklistMode = tlMode;
  state.preview.existingTasklistId = tlMode === 'existing' ? Number(existingSelect.value) : null;
  state.preview.existingTasklistName = tlMode === 'existing'
    ? state.existingTasklists.find((tl) => tl.id === Number(existingSelect.value))?.name
    : null;
  state.preview.assigneeId = assigneeSelect.value ? Number(assigneeSelect.value) : null;

  showScreen('preview');  // must come first — autoResize needs display:block to measure scrollHeight
  renderPreview();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = form.querySelector('button[type="submit"]');

  // ===== Batch AI path =====
  // No project selected yet — each card gets its own project selector on the preview screen.
  if (state.isBatchMode) {
    const validItems = state.batchItems.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setStatus(batchStatus, 'Add at least one action item description.', true);
      return;
    }
    // Cancel any previous in-flight generation (e.g. user went back mid-flight).
    if (state.pendingGeneration) state.pendingGeneration.abort();
    const abortCtrl = new AbortController();
    state.pendingGeneration = abortCtrl;

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Generating…';
    setStatus(batchStatus, `Generating ${validItems.length} task${validItems.length === 1 ? '' : 's'}…`);
    try {
      const results = await Promise.all(
        validItems.map((item) =>
          fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'design',
              description: item.description,
              clientType: item.clientType,
              existingTasklists: [],
            }),
            signal: abortCtrl.signal,
          }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        )
      );
      const failures = results.filter((r) => !r.ok);
      if (failures.length === results.length) {
        setStatus(batchStatus, `All generations failed: ${failures[0]?.data?.error ?? 'unknown error'}`, true);
        return;
      }
      const successResults = results.filter((r) => r.ok);

      if (failures.length > 0) {
        setStatus(batchStatus, `${failures.length} item${failures.length === 1 ? '' : 's'} failed to generate and were skipped.`, true);
      } else {
        setStatus(batchStatus, '');
      }

      if (successResults.length === 1) {
        // Single result — use single-task preview; go to pick-project for project assignment.
        const data = successResults[0].data;
        const item = validItems[results.indexOf(successResults[0])];
        state.preview = {
          // project fields filled in by continue-to-preview after project is picked
          tasklistMode: 'new',
          tasklistName: data.tasklistName,
          parentTaskName: data.parentTaskName,
          parentTaskDescription: data.parentTaskDescription ?? '',
          subtasks: data.subtasks,
          templateId: 'ai-generate',
          templateName: 'AI Generate',
          tags: [],
          notes: item.description,
          monthLabel: '',
          clientType: item.clientType,
          assigneeId: item.assigneeId,
          aiFallback: false,
        };
        state.isBatchMode = false;
        state.batchItems = [];
        showScreen('pick-project');
      } else {
        // Multiple results — go straight to preview with per-card project selectors.
        state.batchPreviews = results.map((r, i) => {
          if (!r.ok) return null;
          const result = r.data;
          return {
            // Per-card project (filled when PM picks a project on the preview card)
            projectId: null,
            projectName: null,
            projectMode: 'existing',
            projectMembers: [],
            existingTasklists: [],
            tasklistMode: 'new',
            existingTasklistId: null,
            existingTasklistName: null,
            // AI-generated content
            tasklistName: result.tasklistName,
            parentTaskName: result.parentTaskName,
            parentTaskDescription: result.parentTaskDescription ?? '',
            subtasks: result.subtasks,
            templateId: 'ai-generate',
            templateName: 'AI Generate',
            tags: [],
            clientType: validItems[i].clientType,
            assigneeId: validItems[i].assigneeId,
            failed: false,
          };
        }).filter(Boolean);
        showScreen('preview');  // must come first — autoResize needs display:block to measure scrollHeight
        renderBatchPreview();
      }
    } catch (err) {
      // AbortError means the user navigated away — don't show an error.
      if (err.name !== 'AbortError') {
        setStatus(batchStatus, `Error: ${err.message}`, true);
      }
    } finally {
      if (state.pendingGeneration === abortCtrl) state.pendingGeneration = null;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
    return;
  }

  // ===== Standard template path =====
  // Generate the preview content here; project is picked on the next screen.
  const vars = currentFormVars();
  const notes = document.getElementById('notes').value.trim();

  // Run the AI tune pass only when the PM actually wrote notes.
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

  // Build preview without project info — filled in by continue-to-preview.
  state.preview = {
    tasklistMode: 'new', // overridden by continue-to-preview
    tasklistName: fillPattern(state.selectedTemplate.tasklistNamePattern, vars),
    existingTasklistId: null,
    existingTasklistName: null,
    parentTaskName: fillPattern(state.selectedTemplate.parentTaskNamePattern, vars),
    parentTaskDescription: '',
    subtasks,
    templateId: state.selectedTemplate.id,
    templateName: state.selectedTemplate.name,
    tags: state.selectedTemplate.defaultTags,
    notes,
    monthLabel: vars.monthLabel,
    clientType: vars.clientType,
    assigneeId: null,
    aiFallback,
  };

  showScreen('pick-project');
});

// ===== screen 3: preview =====

const previewProject = document.getElementById('preview-project');
const previewTasklist = document.getElementById('preview-tasklist');
const previewParentTask = document.getElementById('preview-parent-task');
const previewParentDesc = document.getElementById('preview-parent-desc');
const previewAssigneeRow = document.getElementById('preview-assignee-row');
const previewAssigneeSelect = document.getElementById('preview-assignee-select');
const previewSubtasks = document.getElementById('preview-subtasks');
const previewStatus = document.getElementById('preview-status');
const previewNewProjectRow = document.getElementById('preview-new-project-row');
const previewNewProject = document.getElementById('preview-new-project');
const confirmBtn = document.getElementById('confirm-create');

let dragSrcIdx = null;
// AbortControllers for per-card document click listeners — cleared on each re-render.
let batchCardDocListeners = [];

function autoResize(el) {
  el.style.height = '1px';
  const cssMax = parseFloat(window.getComputedStyle(el).maxHeight) || Infinity;
  const capped = Math.min(el.scrollHeight, cssMax);
  el.style.height = `${capped}px`;
  // Once content exceeds the cap, let CSS overflow-y handle scrolling.
  // For uncapped elements keep overflow hidden so no scrollbar flash.
  el.style.overflowY = el.scrollHeight > cssMax ? 'auto' : 'hidden';
}

function renderPreview() {
  setBatchPreviewVisible(false);
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

  // Parent task assignee row
  if (state.projectMembers.length > 0) {
    previewAssigneeRow.hidden = false;
    previewAssigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
    for (const m of state.projectMembers) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.selected = p.assigneeId != null && p.assigneeId === m.id;
      previewAssigneeSelect.appendChild(opt);
    }
    previewAssigneeSelect.onchange = () => {
      state.preview.assigneeId = previewAssigneeSelect.value ? Number(previewAssigneeSelect.value) : null;
    };
  } else {
    previewAssigneeRow.hidden = true;
  }

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
    desc.placeholder = 'Description…';
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
      showScreen('preview'); // must precede renderPreview — autoResize needs display:block
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
      showScreen('preview'); // must precede renderPreview — autoResize needs display:block
      renderPreview();
    });

    body.appendChild(input);
    body.appendChild(desc);

    if (state.projectMembers.length > 0) {
      const subtaskAssignSel = document.createElement('select');
      subtaskAssignSel.className = 'subtask-assignee';
      const unassignedOpt = document.createElement('option');
      unassignedOpt.value = '';
      unassignedOpt.textContent = '— Unassigned —';
      subtaskAssignSel.appendChild(unassignedOpt);
      for (const m of state.projectMembers) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        opt.selected = subtask.assigneeId != null && subtask.assigneeId === m.id;
        subtaskAssignSel.appendChild(opt);
      }
      subtaskAssignSel.addEventListener('change', () => {
        state.preview.subtasks[Number(input.dataset.index)].assigneeId =
          subtaskAssignSel.value ? Number(subtaskAssignSel.value) : null;
      });
      body.appendChild(subtaskAssignSel);
    }

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

  // Add subtask button (single-task mode)
  let addSubtaskBtn = document.getElementById('add-subtask-btn');
  if (!addSubtaskBtn) {
    addSubtaskBtn = document.createElement('button');
    addSubtaskBtn.type = 'button';
    addSubtaskBtn.id = 'add-subtask-btn';
    addSubtaskBtn.className = 'ghost small';
    addSubtaskBtn.textContent = '+ Add subtask';
    previewSubtasks.after(addSubtaskBtn);
  }
  addSubtaskBtn.onclick = () => {
    state.preview.subtasks.push({ name: '', description: '' });
    renderPreview();
    const inputs = previewSubtasks.querySelectorAll('.subtask-input');
    inputs[inputs.length - 1]?.focus();
  };

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

// ===== batch preview =====

const batchPreviewCards = document.getElementById('batch-preview-cards');
const singlePreviewSummary = document.querySelector('#screen-preview .preview-summary');
const subtasksHeaderEl = document.querySelector('#screen-preview .subtasks-header');
const regeneratePanelContainer = document.getElementById('regenerate-panel');
const subtasksHintEl = document.getElementById('subtasks-hint');

function setBatchPreviewVisible(isBatch) {
  batchPreviewCards.hidden = !isBatch;
  if (singlePreviewSummary) singlePreviewSummary.hidden = isBatch;
  if (subtasksHeaderEl) subtasksHeaderEl.hidden = isBatch;
  if (regeneratePanelContainer) regeneratePanelContainer.hidden = true;
  if (subtasksHintEl) subtasksHintEl.hidden = isBatch;
  previewSubtasks.hidden = isBatch;
  const addStBtn = document.getElementById('add-subtask-btn');
  if (addStBtn) addStBtn.hidden = isBatch;
  document.getElementById('confirm-create').textContent = isBatch ? 'Confirm & create all' : 'Confirm & create';
  const toggleBtn = document.getElementById('toggle-regenerate');
  if (toggleBtn) toggleBtn.hidden = isBatch;
}

function updateBatchConfirmSummary() {
  const confirmSummary = document.getElementById('confirm-summary');
  if (!confirmSummary) return;
  const total = state.batchPreviews.reduce((n, p) => n + p.subtasks.length, 0);
  const unassigned = state.batchPreviews.filter((p) => !p.projectId).length;
  let text = `${state.batchPreviews.length} task${state.batchPreviews.length === 1 ? '' : 's'} · ${total} subtask${total === 1 ? '' : 's'}`;
  if (unassigned > 0) text += ` · ⚠ ${unassigned} need a project`;
  confirmSummary.textContent = text;
}

function renderBatchPreview() {
  // Abort all document click listeners from the previous render before rebuilding.
  batchCardDocListeners.forEach(ctrl => ctrl.abort());
  batchCardDocListeners = [];
  setBatchPreviewVisible(true);
  batchPreviewCards.innerHTML = '';

  state.batchPreviews.forEach((p, cardIdx) => {
    const card = document.createElement('div');
    card.className = 'batch-preview-card';
    card.dataset.cardIndex = cardIdx;

    // ----- Header -----
    const header = document.createElement('div');
    header.className = 'batch-preview-card-header';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'batch-card-toggle ghost small';
    toggleBtn.setAttribute('aria-expanded', 'true');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'batch-card-title';
    titleSpan.textContent = p.tasklistName;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost small batch-card-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.batchPreviews.splice(cardIdx, 1);
      renderBatchPreview();
    });

    header.appendChild(toggleBtn);
    header.appendChild(titleSpan);
    header.appendChild(removeBtn);

    // ----- Body -----
    const body = document.createElement('div');
    body.className = 'batch-preview-card-body';

    // ----- Per-card project picker -----
    const projectRow = document.createElement('div');
    projectRow.className = 'preview-row batch-card-project-row';
    const projectLabel = document.createElement('span');
    projectLabel.className = 'preview-label';
    projectLabel.textContent = 'Project';

    const projectPicker = document.createElement('div');
    projectPicker.className = 'batch-card-project-picker';

    // Display when a project is already selected
    const projectSelectedEl = document.createElement('div');
    projectSelectedEl.className = 'batch-card-project-selected';
    projectSelectedEl.hidden = !p.projectId;

    // Search UI (shown when no project selected)
    const projectSearchWrap = document.createElement('div');
    projectSearchWrap.className = 'batch-card-project-search';
    projectSearchWrap.hidden = !!p.projectId;

    const projectSearchInput = document.createElement('input');
    projectSearchInput.type = 'search';
    projectSearchInput.placeholder = 'Search projects…';
    projectSearchInput.className = 'batch-card-project-search-input';

    const projectSearchStatus = document.createElement('div');
    projectSearchStatus.className = 'status';
    projectSearchStatus.setAttribute('aria-live', 'polite');

    const projectSearchResults = document.createElement('ul');
    projectSearchResults.className = 'results batch-card-project-results';
    projectSearchResults.setAttribute('role', 'listbox');

    projectSearchWrap.appendChild(projectSearchInput);
    projectSearchWrap.appendChild(projectSearchStatus);
    projectSearchWrap.appendChild(projectSearchResults);

    let cardDebounce = null;
    let cardReqId = 0;

    async function searchCardProjects(term) {
      const reqId = ++cardReqId;
      setStatus(projectSearchStatus, term ? `Searching for "${term}"…` : 'Loading…');
      const url = new URL('/api/projects', window.location.origin);
      if (term) url.searchParams.set('search', term);
      try {
        const res = await fetch(url);
        if (reqId !== cardReqId) return;
        if (!res.ok) { setStatus(projectSearchStatus, `Error: ${res.statusText}`, true); return; }
        const { projects } = await res.json();
        projectSearchResults.innerHTML = '';
        for (const proj of projects) {
          const li = document.createElement('li');
          li.tabIndex = 0;
          li.setAttribute('role', 'option');
          li.innerHTML = '<span class="project-name"></span><span class="project-id"></span>';
          li.querySelector('.project-name').textContent = proj.name;
          li.querySelector('.project-id').textContent = `#${proj.id}`;
          li.addEventListener('click', () => pickCardProject(proj));
          li.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickCardProject(proj); }
          });
          projectSearchResults.appendChild(li);
        }
        setStatus(projectSearchStatus, projects.length === 0 ? 'No projects matched.' : '');
      } catch (err) {
        if (reqId !== cardReqId) return;
        setStatus(projectSearchStatus, `Network error: ${err.message}`, true);
      }
    }

    projectSearchInput.addEventListener('input', (ev) => {
      clearTimeout(cardDebounce);
      cardDebounce = setTimeout(() => searchCardProjects(ev.target.value.trim()), 200);
    });
    projectSearchInput.addEventListener('focus', () => {
      if (!projectSearchResults.children.length) searchCardProjects('');
    });

    function renderProjectSelectedEl() {
      projectSelectedEl.innerHTML = '';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'project-name';
      nameSpan.textContent = p.projectName;
      const changeBtn = document.createElement('button');
      changeBtn.type = 'button';
      changeBtn.className = 'ghost small';
      changeBtn.textContent = 'Change';
      changeBtn.addEventListener('click', () => {
        p.projectId = null;
        p.projectName = null;
        p.projectMembers = [];
        p.assigneeId = null;
        projectSelectedEl.hidden = true;
        projectSearchWrap.hidden = false;
        projectSearchInput.value = '';
        projectSearchResults.innerHTML = '';
        setStatus(projectSearchStatus, '');
        refreshCardAssignee();
        renderCardSubtasks();
        updateBatchConfirmSummary();
      });
      projectSelectedEl.appendChild(nameSpan);
      projectSelectedEl.appendChild(changeBtn);
    }
    if (p.projectId) renderProjectSelectedEl();

    async function pickCardProject(proj) {
      p.projectId = proj.id;
      p.projectName = proj.name;
      p.projectMembers = [];
      p.assigneeId = null;
      renderProjectSelectedEl();
      projectSelectedEl.hidden = false;
      projectSearchWrap.hidden = true;
      setStatus(projectSearchStatus, '');
      try {
        const res = await fetch(`/api/projects/${proj.id}/members`);
        if (res.ok) {
          const { members } = await res.json();
          p.projectMembers = members;
          refreshCardAssignee();
          renderCardSubtasks();
        }
      } catch { /* members stay empty */ }
      updateBatchConfirmSummary();
    }

    // Close dropdown when clicking outside the search wrap.
    // Use an AbortController so the listener is cleaned up when renderBatchPreview
    // rebuilds the cards — avoids unbounded listener accumulation on document.
    function onDocClickCard(e) {
      if (!projectSearchWrap.contains(e.target)) {
        projectSearchResults.innerHTML = '';
        setStatus(projectSearchStatus, '');
      }
    }
    const docListenerCtrl = new AbortController();
    batchCardDocListeners.push(docListenerCtrl);
    document.addEventListener('click', onDocClickCard, { signal: docListenerCtrl.signal });

    projectPicker.appendChild(projectSelectedEl);
    projectPicker.appendChild(projectSearchWrap);
    projectRow.appendChild(projectLabel);
    projectRow.appendChild(projectPicker);

    // ----- Tasklist name -----
    const tlRow = document.createElement('div');
    tlRow.className = 'preview-row';
    const tlLabel = document.createElement('span');
    tlLabel.className = 'preview-label';
    tlLabel.textContent = 'Tasklist';
    const tlInput = document.createElement('textarea');
    tlInput.className = 'inline-edit';
    tlInput.rows = 1;
    tlInput.value = p.tasklistName;
    tlInput.addEventListener('input', () => {
      state.batchPreviews[cardIdx].tasklistName = tlInput.value;
      titleSpan.textContent = tlInput.value || `Task ${cardIdx + 1}`;
      autoResize(tlInput);
    });
    tlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    tlRow.appendChild(tlLabel);
    tlRow.appendChild(tlInput);

    // ----- Parent task -----
    const ptRow = document.createElement('div');
    ptRow.className = 'preview-row preview-row--top';
    const ptLabel = document.createElement('span');
    ptLabel.className = 'preview-label';
    ptLabel.textContent = 'Parent task';
    const ptStack = document.createElement('div');
    ptStack.className = 'inline-stack';
    const ptInput = document.createElement('textarea');
    ptInput.className = 'inline-edit';
    ptInput.rows = 1;
    ptInput.value = p.parentTaskName;
    ptInput.addEventListener('input', () => {
      state.batchPreviews[cardIdx].parentTaskName = ptInput.value;
      autoResize(ptInput);
    });
    ptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    const pdInput = document.createElement('textarea');
    pdInput.className = 'inline-edit inline-edit--desc';
    pdInput.rows = 1;
    pdInput.placeholder = 'Description…';
    pdInput.value = p.parentTaskDescription ?? '';
    pdInput.addEventListener('input', () => {
      state.batchPreviews[cardIdx].parentTaskDescription = pdInput.value;
      autoResize(pdInput);
    });
    ptStack.appendChild(ptInput);
    ptStack.appendChild(pdInput);
    ptRow.appendChild(ptLabel);
    ptRow.appendChild(ptStack);

    // ----- Assignee row (shown after members load) -----
    const asRow = document.createElement('div');
    asRow.className = 'preview-row';
    asRow.hidden = true;
    const asLabel = document.createElement('span');
    asLabel.className = 'preview-label';
    asLabel.textContent = 'Assignee';
    const asSel = document.createElement('select');
    asSel.className = 'preview-assignee-select';
    asSel.innerHTML = '<option value="">— Unassigned —</option>';
    asSel.addEventListener('change', () => {
      state.batchPreviews[cardIdx].assigneeId = asSel.value ? Number(asSel.value) : null;
    });
    asRow.appendChild(asLabel);
    asRow.appendChild(asSel);

    function refreshCardAssignee() {
      if (p.projectMembers.length > 0) {
        asSel.innerHTML = '<option value="">— Unassigned —</option>';
        for (const m of p.projectMembers) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          opt.selected = p.assigneeId != null && p.assigneeId === m.id;
          asSel.appendChild(opt);
        }
        asRow.hidden = false;
      } else {
        asRow.hidden = true;
      }
    }
    refreshCardAssignee();

    // ----- Subtasks -----
    const stHeader = document.createElement('div');
    stHeader.className = 'subtasks-header';
    const stTitle = document.createElement('h2');
    stTitle.className = 'section-label';
    stTitle.textContent = 'Subtasks';
    stHeader.appendChild(stTitle);

    const subtaskList = document.createElement('ol');
    subtaskList.className = 'subtasks';

    function renderCardSubtasks() {
      subtaskList.innerHTML = '';
      const toResize = [];
      let cardDragSrcIdx = null; // per-card drag source; shared across all li listeners in this render
      p.subtasks.forEach((subtask, stIdx) => {
        const li = document.createElement('li');
        li.setAttribute('draggable', 'true');
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.setAttribute('aria-hidden', 'true');
        const stBody = document.createElement('div');
        stBody.className = 'subtask-body';
        const stInput = document.createElement('textarea');
        stInput.className = 'subtask-input';
        stInput.value = subtask.name;
        stInput.rows = 1;
        stInput.addEventListener('input', () => {
          state.batchPreviews[cardIdx].subtasks[stIdx].name = stInput.value;
          autoResize(stInput);
        });
        stInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        const stDesc = document.createElement('textarea');
        stDesc.className = 'subtask-desc';
        stDesc.value = subtask.description ?? '';
        stDesc.rows = 1;
        stDesc.placeholder = 'Description…';
        stDesc.addEventListener('input', () => {
          state.batchPreviews[cardIdx].subtasks[stIdx].description = stDesc.value;
          autoResize(stDesc);
        });
        stDesc.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        const stRemove = document.createElement('button');
        stRemove.type = 'button';
        stRemove.className = 'remove';
        stRemove.title = 'Remove subtask';
        stRemove.textContent = '×';
        stRemove.addEventListener('click', () => {
          state.batchPreviews[cardIdx].subtasks.splice(stIdx, 1);
          renderCardSubtasks();
        });

        // Drag-to-reorder (mirrors single-task preview behaviour)
        li.addEventListener('dragstart', (e) => {
          cardDragSrcIdx = stIdx;
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => li.classList.add('dragging'), 0);
        });
        li.addEventListener('dragend', () => {
          li.classList.remove('dragging');
          subtaskList.querySelectorAll('li').forEach((el) => el.classList.remove('drag-over'));
        });
        li.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (cardDragSrcIdx !== stIdx) {
            subtaskList.querySelectorAll('li').forEach((el) => el.classList.remove('drag-over'));
            li.classList.add('drag-over');
          }
        });
        li.addEventListener('dragleave', (e) => {
          if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
        });
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          li.classList.remove('drag-over');
          if (cardDragSrcIdx === null || cardDragSrcIdx === stIdx) return;
          const subtasks = state.batchPreviews[cardIdx].subtasks;
          const [moved] = subtasks.splice(cardDragSrcIdx, 1);
          subtasks.splice(stIdx, 0, moved);
          cardDragSrcIdx = null;
          renderCardSubtasks();
        });

        stBody.appendChild(stInput);
        stBody.appendChild(stDesc);

        if (p.projectMembers.length > 0) {
          const stAssignSel = document.createElement('select');
          stAssignSel.className = 'subtask-assignee';
          const stNoneOpt = document.createElement('option');
          stNoneOpt.value = '';
          stNoneOpt.textContent = '— Unassigned —';
          stAssignSel.appendChild(stNoneOpt);
          for (const m of p.projectMembers) {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            opt.selected = subtask.assigneeId != null && subtask.assigneeId === m.id;
            stAssignSel.appendChild(opt);
          }
          stAssignSel.addEventListener('change', () => {
            state.batchPreviews[cardIdx].subtasks[stIdx].assigneeId =
              stAssignSel.value ? Number(stAssignSel.value) : null;
          });
          stBody.appendChild(stAssignSel);
        }

        li.appendChild(handle);
        li.appendChild(stBody);
        li.appendChild(stRemove);
        subtaskList.appendChild(li);
        // Collect for deferred resize — elements must be in the live DOM first.
        toResize.push(stInput, stDesc);
      });
      // Resize after the browser has laid out the subtaskList in the document.
      requestAnimationFrame(() => toResize.forEach(el => autoResize(el)));
    }
    renderCardSubtasks();

    const addStBtn = document.createElement('button');
    addStBtn.type = 'button';
    addStBtn.className = 'ghost small';
    addStBtn.textContent = '+ Add subtask';
    addStBtn.addEventListener('click', () => {
      state.batchPreviews[cardIdx].subtasks.push({ name: '', description: '' });
      renderCardSubtasks();
      const inputs = subtaskList.querySelectorAll('.subtask-input');
      inputs[inputs.length - 1]?.focus();
    });

    body.appendChild(projectRow);
    body.appendChild(tlRow);
    body.appendChild(ptRow);
    body.appendChild(asRow);
    body.appendChild(stHeader);
    body.appendChild(document.createRange().createContextualFragment('<p class="hint">Click to edit · clear to remove.</p>'));
    body.appendChild(subtaskList);
    body.appendChild(addStBtn);

    toggleBtn.addEventListener('click', () => {
      const isOpen = body.hidden;
      body.hidden = !isOpen;
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
    });

    card.appendChild(header);
    card.appendChild(body);
    batchPreviewCards.appendChild(card);

    requestAnimationFrame(() => {
      autoResize(tlInput);
      autoResize(ptInput);
      autoResize(pdInput);
    });
  });

  updateBatchConfirmSummary();
}

async function confirmBatchCreate() {
  const confirmBtn = document.getElementById('confirm-create');
  const previewStatusEl = document.getElementById('preview-status');
  const confirmSummary = document.getElementById('confirm-summary');

  // Validate each card: needs a project, a parent task name, and at least one subtask.
  for (let i = 0; i < state.batchPreviews.length; i++) {
    const p = state.batchPreviews[i];
    if (!p.projectId) {
      setStatus(previewStatusEl, `Task ${i + 1}: select a project before creating.`, true);
      return;
    }
    p.subtasks = p.subtasks
      .map((s) => ({ name: s.name.trim(), description: (s.description ?? '').trim() }))
      .filter((s) => s.name);
    if (!p.parentTaskName.trim()) {
      setStatus(previewStatusEl, `Task ${i + 1}: parent task name cannot be empty.`, true);
      return;
    }
    if (p.subtasks.length === 0) {
      setStatus(previewStatusEl, `Task ${i + 1}: add at least one subtask before creating.`, true);
      return;
    }
  }

  confirmBtn.disabled = true;
  const results = [];

  // Create each task in sequence (Teamwork rejects parallel writes from the same token).
  for (let i = 0; i < state.batchPreviews.length; i++) {
    const p = state.batchPreviews[i];
    setStatus(previewStatusEl, `Creating task ${i + 1} of ${state.batchPreviews.length}…`);
    if (confirmSummary) confirmSummary.textContent = `Creating task ${i + 1} of ${state.batchPreviews.length}…`;

    const payload = {
      tasklistMode: 'new',        // batch mode always creates new tasklists
      projectId: p.projectId,
      tasklistName: p.tasklistName,
      parentTaskName: p.parentTaskName.trim(),
      parentTaskDescription: (p.parentTaskDescription ?? '').trim(),
      subtasks: p.subtasks,
      tags: p.tags ?? [],
    };
    if (p.assigneeId) payload.assigneeId = p.assigneeId;

    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      results.push({ ok: res.ok, result, tasklistName: p.tasklistName, projectName: p.projectName });
    } catch (err) {
      results.push({ ok: false, result: { error: err.message }, tasklistName: p.tasklistName, projectName: p.projectName });
    }
  }

  renderBatchSuccess(results);
  showScreen('success');
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
  // Cancel any in-flight generation so it doesn't re-enable/disable the button
  // after the user has already navigated away.
  if (state.pendingGeneration) {
    state.pendingGeneration.abort();
    state.pendingGeneration = null;
  }
  // Clean up any batch-card document listeners from the batch preview screen.
  batchCardDocListeners.forEach(ctrl => ctrl.abort());
  batchCardDocListeners = [];
  // Defensively restore button + clear status in case we're going back mid-generate.
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = false;
  setStatus(batchStatus, '');

  // Batch mode skips pick-project, so go back to configure.
  // Single / template mode goes back to pick-project (project already set).
  if (state.isBatchMode || !state.selectedProject) {
    const isAi = form.querySelector('input[name="taskMode"][value="ai-generate"]')?.checked ?? false;
    state.isBatchMode = isAi;
    showScreen('form');
  } else {
    showScreen('pick-project');
  }
});

confirmBtn.addEventListener('click', async () => {
  if (state.isBatchMode) { confirmBatchCreate(); return; }
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
  if (p.assigneeId) payload.assigneeId = p.assigneeId;
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

function renderBatchSuccess(results) {
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const totalSubtasks = succeeded.reduce((n, r) => n + (r.result.subtaskIds?.length ?? 0), 0);
  let summary = `Created ${succeeded.length} of ${results.length} task${results.length === 1 ? '' : 's'}`;
  if (totalSubtasks > 0) summary += ` (${totalSubtasks} subtask${totalSubtasks === 1 ? '' : 's'} total)`;

  // Show unique project names in summary
  const projectNames = [...new Set(succeeded.map((r) => r.projectName).filter(Boolean))];
  if (projectNames.length === 1) summary += ` in "${projectNames[0]}"`;
  else if (projectNames.length > 1) summary += ` across ${projectNames.length} projects`;
  summary += '.';
  successSummary.textContent = summary;

  if (failed.length > 0) {
    successPartial.textContent = `Failed tasks:\n${failed.map((r) => `• ${r.tasklistName}: ${r.result.error}`).join('\n')}`;
  } else {
    successPartial.textContent = '';
  }

  // Link to the last successfully created tasklist
  const lastOk = succeeded[succeeded.length - 1];
  if (lastOk?.result?.tasklistUrl) {
    successLink.href = lastOk.result.tasklistUrl;
    successLink.textContent = 'Open last tasklist in Teamwork ↗';
    successLink.hidden = false;
  } else {
    successLink.hidden = true;
  }

  successProjectLink.hidden = true; // no single project link in multi-project batch
}

document.getElementById('start-over').addEventListener('click', () => {
  batchCardDocListeners.forEach(ctrl => ctrl.abort());
  batchCardDocListeners = [];
  state.preview = null;
  state.batchPreviews = [];
  state.batchItems = [];
  state.isBatchMode = false;
  state.newProjectDraft = null;
  state.selectedProject = null;
  state.projectMembers = [];
  state.existingTasklists = [];
  document.getElementById('notes').value = '';
  newProjectNameInput.value = '';
  newProjectDescInput.value = '';
  regenerateDesc.value = '';
  searchInput.value = '';
  setRegeneratePanelOpen(false);
  state.selectedTemplate = TEMPLATES[0];
  if (aiGeneratePrompt) aiGeneratePrompt.value = '';
  setStatus(aiGenerateStatus, '');
  setStatus(batchStatus, '');
  assigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
  assigneeSelect.disabled = true;
  assigneeHint.textContent = '';
  projectSelectedPanel.hidden = true;
  setBatchPreviewVisible(false);
  batchPreviewCards.innerHTML = '';
  const taskModeRadio = form.querySelector('input[name="taskMode"][value="ai-generate"]');
  if (taskModeRadio) taskModeRadio.checked = true;
  const firstTemplateRadio = form.querySelector('input[name="template"][value="email-campaign"]');
  if (firstTemplateRadio) firstTemplateRadio.checked = true;
  setAiGenerateMode(true);
  setProjectMode('existing');
  showScreen('form');
});

// ===== shared helpers =====

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.toggle('working', !isError && !!text);
}

// ===== boot =====

updateTasklistPreview();
setAiGenerateMode(true);
// Start on the configure screen (step 1)
showScreen('form');
