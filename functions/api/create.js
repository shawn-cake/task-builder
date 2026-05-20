// POST /api/create
// Orchestrates task creation:
//   1. If `tasklistMode === "new"`: create the tasklist (v1 endpoint).
//      Otherwise reuse the supplied existing `tasklistId`.
//   2. Create the parent task in that tasklist (v3 endpoint).
//   3. Create one subtask per item in the `subtasks` array (v3 endpoint).
//
// Returns the IDs/URLs of what was created. If a subtask write fails
// mid-flight we still report what got through — there is no transactional
// API and silent partial-success would be worse than surfacing the truth.
//
// Request body shape:
// {
//   "tasklistMode": "new" | "existing",
//   "tasklistName": "SEO. C. May 2026 Email Campaign",   // when "new"
//   "tasklistId": 123456,                                  // when "existing"
//   "projectId": 61030,                                    // when "new"
//   "parentTaskName": "May 2026 Email Campaign",
//   "subtasks": ["Develop text...", "Tag Andi...", ...],
//   "tags": [{"id": 81162, "name": "Email"}]               // optional
// }

export async function onRequestPost({ request, env }) {
  const { TEAMWORK_DOMAIN, TEAMWORK_API_TOKEN } = env;
  if (!TEAMWORK_DOMAIN || !TEAMWORK_API_TOKEN) {
    return Response.json({ error: 'Server not configured.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validation = validate(body);
  if (validation) return Response.json({ error: validation }, { status: 400 });

  const tw = new TeamworkClient(TEAMWORK_DOMAIN, TEAMWORK_API_TOKEN);
  const created = { tasklistId: null, tasklistUrl: null, parentTaskId: null, subtaskIds: [], partial: false, errors: [] };

  // Step 1 — tasklist
  try {
    if (body.tasklistMode === 'new') {
      const tl = await tw.createTasklist(body.projectId, body.tasklistName);
      created.tasklistId = tl.id;
      created.tasklistUrl = tl.url;
    } else {
      created.tasklistId = body.tasklistId;
      created.tasklistUrl = `https://${TEAMWORK_DOMAIN}/tasklists/${body.tasklistId}`;
    }
  } catch (e) {
    return Response.json({ error: `Failed to create tasklist: ${e.message}` }, { status: 502 });
  }

  // Step 2 — parent task
  let parentTaskId;
  try {
    parentTaskId = await tw.createTask(
      created.tasklistId,
      body.parentTaskName,
      body.parentTaskDescription ?? '',
      body.tags ?? []
    );
    created.parentTaskId = parentTaskId;
  } catch (e) {
    return Response.json(
      { error: `Tasklist created but parent task failed: ${e.message}`, created },
      { status: 502 }
    );
  }

  // Step 3 — subtasks (sequential — the API rejects parallel writes from the same token)
  for (const subtask of body.subtasks) {
    const name = typeof subtask === 'string' ? subtask : subtask.name;
    const description = typeof subtask === 'string' ? '' : (subtask.description ?? '');
    try {
      const id = await tw.createSubtask(parentTaskId, name, description);
      created.subtaskIds.push(id);
    } catch (e) {
      created.partial = true;
      created.errors.push({ subtask: name, error: e.message });
    }
  }

  return Response.json({ ...created, success: !created.partial });
}

// ----- helpers -----

function validate(body) {
  if (!body || typeof body !== 'object') return 'Body must be an object.';
  if (!['new', 'existing'].includes(body.tasklistMode)) return 'tasklistMode must be "new" or "existing".';
  if (body.tasklistMode === 'new') {
    if (!body.projectId) return 'projectId required when creating a new tasklist.';
    if (!body.tasklistName?.trim()) return 'tasklistName required when creating a new tasklist.';
  } else {
    if (!body.tasklistId) return 'tasklistId required when adding to existing tasklist.';
  }
  if (!body.parentTaskName?.trim()) return 'parentTaskName required.';
  if (!Array.isArray(body.subtasks) || body.subtasks.length === 0) return 'subtasks must be a non-empty array.';
  if (body.subtasks.some((s) => typeof s !== 'string' || !s.trim())) return 'each subtask must be a non-empty string.';
  if (body.tags && !Array.isArray(body.tags)) return 'tags must be an array.';
  return null;
}

class TeamworkClient {
  constructor(domain, token) {
    this.domain = domain;
    this.auth = `Basic ${btoa(`${token}:x`)}`;
  }

  async createTasklist(projectId, name) {
    // v1 endpoint — v3 returns 405 for this resource.
    const res = await fetch(`https://${this.domain}/projects/${projectId}/tasklists.json`, {
      method: 'POST',
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 'todo-list': { name } }),
    });
    if (!res.ok) throw new Error(`tasklist create ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      id: Number(data.TASKLISTID),
      url: res.headers.get('Location') ?? `https://${this.domain}/tasklists/${data.TASKLISTID}`,
    };
  }

  async createTask(tasklistId, name, description, tags) {
    const task = { name };
    if (description) task.description = description;
    const res = await fetch(
      `https://${this.domain}/projects/api/v3/tasklists/${tasklistId}/tasks.json`,
      {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, tags }),
      }
    );
    if (!res.ok) throw new Error(`task create ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.task.id;
  }

  async createSubtask(parentTaskId, name, description) {
    const task = { name };
    if (description) task.description = description;
    const res = await fetch(
      `https://${this.domain}/projects/api/v3/tasks/${parentTaskId}/subtasks.json`,
      {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      }
    );
    if (!res.ok) throw new Error(`subtask create ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.task.id;
  }
}
