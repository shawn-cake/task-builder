// POST /api/preview
//
// Three modes:
//   - mode: "tune"    → take N default subtasks + notes, return same N adjusted
//   - mode: "generate"→ take a description, return N subtasks (no names)
//   - mode: "design"  → take a description, return tasklistName + parentTaskName
//                       + N subtasks (full output for the AI Generate template path)

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_TUNE = `You help internal project managers at a marketing agency customize the subtask wording for recurring tasklists in their project management tool. Your output is internal PM-facing operational text, not customer-facing copy.

Rules:
- Return EXACTLY the same number of subtasks as you receive, in the same order. Never add or remove subtasks — only adjust wording.
- Only change a subtask's wording if the PM's notes give a concrete reason. If a subtask doesn't need changes, return it verbatim.
- If a subtask references something the client doesn't have (e.g., notes say "no specials page"), keep the subtask but adjust the wording to acknowledge that — e.g., "Update specials page if applicable; otherwise skip." Do not drop the subtask.
- Preserve "[Project manager]", "[Copywriter]", and any other bracketed role prefixes exactly as given.
- Keep wording crisp and action-oriented; this is internal text, not client-facing.`;

const SYSTEM_GENERATE = `You help internal project managers at a marketing agency compose a tasklist for a recurring or one-off marketing campaign. Your output is internal PM-facing operational text.

Rules:
- Produce a clean ordered list of subtasks that captures the work end-to-end.
- Typical campaigns have 5-12 subtasks. Don't pad to hit a number; output as many as the work actually needs.
- Each subtask is a single concrete action, written as an imperative ("Send X", "Tag Y for review", "Update Z").
- Use "[Project manager]" prefix only for tasks that explicitly require the PM (e.g., client communication).
- Don't include dates, assignees, or tags — those are handled separately by the tool.`;

const SYSTEM_DESIGN = `You help internal project managers at a digital marketing agency create complete tasklists for any kind of campaign or project task. Your output is internal PM-facing operational text.

The input may be a PM's own description OR a raw client email. If it's a client email, extract the relevant task details and ignore signatures, pleasantries, and unrelated content.

Given the input, produce three things:
1. tasklistName — a short name for the tasklist:
   - If a contract type code is provided (C, H, or G), it MUST appear in the tasklist name as "[ClientType. ]" — always, for every task type.
   - For recurring monthly content (email campaigns, blog posts, social media): use the pattern "[Prefix. ][ClientType. ][Month Year] [Task Type]"
     - Prefix: look at the first word of the project name. If it is a recognizable service category (e.g. SEO, PPC, Social, Email), use it as the prefix. Otherwise omit the prefix entirely.
     - Example: project "SEO www.example.com", contract type C → "SEO. C. May 2026 Email Campaign"
     - Example: project "Kirby Plastic Surgery", no contract type → "May 2026 Email Campaign"
   - For everything else (website updates, product additions, design requests, one-off tasks, etc.): use a clean 3-7 word descriptive name with no date. Contract type still appears: e.g. contract type H → "H. New Product Page Build"
2. parentTaskName — the main task that will sit at the top of the tasklist. Can follow the same naming as the tasklist, or be more descriptive if that's clearer.
3. subtasks — ordered list of subtasks that capture the work end-to-end.

Rules for subtasks:
- Each subtask is a single concrete action written as an imperative ("Send X", "Review Y", "Update Z").
- Use "[Project manager]" prefix for client-facing or approval tasks.
- Use "[Copywriter]" prefix for tasks that are specifically the copywriter's responsibility.
- Don't include dates, assignees, or tags.
- Don't pad — output as many subtasks as the work actually needs.
- Dependency detection: if the input mentions that something is pending, coming soon, or will be provided later by the client (e.g. images, copy, assets, approvals), add a subtask near the top of the list that surfaces that dependency — written as an action for the team, e.g. "Receive product images from client" or "Wait for client to provide updated copy." Place it before any subtasks that depend on it.
- URL inclusion: if the input contains URLs tied to specific items being worked on (e.g. a product page, a reference page), include the URL inline in the relevant subtask — e.g. "Review Age Reversal Neck Cream product page (https://...)" — so the team has quick access without hunting through the original email.
- Descriptions: you may optionally add a short description to the parentTask and/or individual subtasks when there is meaningful context worth preserving — specific details, reference links, a pending dependency, or a nuance that won't fit cleanly in the task name. Omit the description entirely (empty string) when the name is self-explanatory. Never add a description just to restate the task name.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    subtasks: { type: 'array', items: { type: 'string' } },
  },
  required: ['subtasks'],
  additionalProperties: false,
};

const DESIGN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    tasklistName: { type: 'string' },
    parentTaskName: { type: 'string' },
    parentTaskDescription: { type: 'string' },
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasklistName', 'parentTaskName', 'parentTaskDescription', 'subtasks'],
  additionalProperties: false,
};

export async function onRequestPost({ request, env }) {
  const { ANTHROPIC_API_KEY } = env;
  if (!ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Server not configured (missing ANTHROPIC_API_KEY).' },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validation = validate(body);
  if (validation) return Response.json({ error: validation }, { status: 400 });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Design mode returns a different shape — handle separately.
  if (body.mode === 'design') {
    try {
      const result = await design(client, body);
      return Response.json({ ...result, mode: 'design' });
    } catch (err) {
      return Response.json(
        { error: `Generation failed: ${err.message}` },
        { status: 502 }
      );
    }
  }

  try {
    const subtasks =
      body.mode === 'tune'
        ? await tune(client, body)
        : await generate(client, body);
    return Response.json({ subtasks, mode: body.mode });
  } catch (err) {
    if (body.mode === 'tune') {
      return Response.json({
        subtasks: body.subtasks,
        mode: 'tune',
        fallback: true,
        error: err.message,
      });
    }
    return Response.json(
      { error: `Anthropic API error: ${err.message}` },
      { status: 502 }
    );
  }
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Body must be an object.';
  if (!['tune', 'generate', 'design'].includes(body.mode)) {
    return 'mode must be "tune", "generate", or "design".';
  }
  if (body.mode === 'tune') {
    if (!Array.isArray(body.subtasks) || body.subtasks.length === 0) {
      return 'subtasks must be a non-empty array for tune mode.';
    }
    if (body.subtasks.some((s) => typeof s !== 'string')) {
      return 'every subtask must be a string.';
    }
  } else {
    if (!body.description?.trim()) return `description is required for ${body.mode} mode.`;
    if (body.description.length > 8000) return 'description must be under 8 000 characters.';
  }
  return null;
}

function buildContext(body) {
  const parts = [`Client / project: ${body.projectName ?? '(unspecified)'}`];
  if (body.monthLabel) parts.push(`Month: ${body.monthLabel}`);
  if (body.clientType) parts.push(`Contract type: ${body.clientType}`);
  if (body.templateName) parts.unshift(`Template: ${body.templateName}`);
  return parts.join('\n');
}

async function tune(client, body) {
  const userPrompt = `${buildContext(body)}

Default subtasks (in order):
${body.subtasks.map((s, i) => `${i + 1}. ${s}`).join('\n')}

PM's notes for this run:
${body.notes?.trim() || '(no notes — return the subtasks unchanged)'}`;

  return await callAnthropic(client, SYSTEM_TUNE, userPrompt, OUTPUT_SCHEMA);
}

async function generate(client, body) {
  const userPrompt = `${buildContext(body)}

Describe what this tasklist should accomplish:
${body.description.trim()}`;

  return await callAnthropic(client, SYSTEM_GENERATE, userPrompt, OUTPUT_SCHEMA);
}

async function design(client, body) {
  const parts = [`Project: ${body.projectName ?? '(unspecified)'}`];
  if (body.clientType) {
    const typeLabel = { C: 'Contract', H: 'Hourly', G: 'Gratis' }[body.clientType] ?? body.clientType;
    parts.push(`Contract type: ${typeLabel} (${body.clientType})`);
  }
  if (Array.isArray(body.existingTasklists) && body.existingTasklists.length > 0) {
    parts.push('', 'Existing tasklists in this project (derive naming convention from these; avoid exact duplicates):');
    for (const name of body.existingTasklists) parts.push(`- ${name}`);
  }
  parts.push('', "PM's description:", body.description.trim());
  const userPrompt = parts.join('\n');

  const raw = await callAnthropic(client, SYSTEM_DESIGN, userPrompt, DESIGN_OUTPUT_SCHEMA, { fullDesign: true });

  // Safety net: ensure the contract type code is present in the tasklist name.
  // The model should include it per the system prompt, but post-process just in case.
  if (body.clientType) {
    const ct = body.clientType;
    if (!raw.tasklistName.includes(`${ct}. `)) {
      // Insert after a leading service-category prefix (e.g. "SEO. ") if present,
      // otherwise prepend directly.
      const prefixMatch = raw.tasklistName.match(/^([A-Z]{2,6}\. )/);
      raw.tasklistName = prefixMatch
        ? `${prefixMatch[0]}${ct}. ${raw.tasklistName.slice(prefixMatch[0].length)}`
        : `${ct}. ${raw.tasklistName}`;
    }
  }

  return raw;
}

async function callAnthropic(client, system, userPrompt, schema, { fullDesign = false } = {}) {
  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = result.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`model returned non-JSON: ${text.slice(0, 200)}`);
  }

  // Full-design mode — return the whole object.
  if (fullDesign) {
    if (!parsed?.tasklistName || !parsed?.parentTaskName || !Array.isArray(parsed?.subtasks)) {
      throw new Error('model returned an unexpected shape');
    }
    return {
      tasklistName: parsed.tasklistName.trim(),
      parentTaskName: parsed.parentTaskName.trim(),
      parentTaskDescription: (parsed.parentTaskDescription ?? '').trim(),
      subtasks: parsed.subtasks
        .filter((s) => s?.name?.trim())
        .map((s) => ({ name: s.name.trim(), description: (s.description ?? '').trim() })),
    };
  }

  // Subtasks-only schema.
  if (!parsed || !Array.isArray(parsed.subtasks)) {
    throw new Error('model returned an unexpected shape');
  }
  return parsed.subtasks
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
}
