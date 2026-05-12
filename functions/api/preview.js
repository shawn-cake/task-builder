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

Given a PM's description, you produce three things:
1. tasklistName — a short name for the tasklist, following the agency pattern when appropriate:
   - For recurring SEO/email/blog/social work: "SEO. C. [Month Year] [Task Type]" (use the client type if given, otherwise C)
   - For one-off or non-SEO work: a clean 3-7 word descriptive name
2. parentTaskName — the main task that will sit at the top of the tasklist. Can follow the same naming as the tasklist, or be more descriptive if that's clearer.
3. subtasks — ordered list of 5-12 subtasks that capture the work end-to-end.

Rules for subtasks:
- Each subtask is a single concrete action written as an imperative ("Send X", "Review Y", "Update Z").
- Use "[Project manager]" prefix for client-facing or approval tasks.
- Use "[Copywriter]" prefix for tasks that are specifically the copywriter's responsibility.
- Don't include dates, assignees, or tags.
- Don't pad — output as many subtasks as the work actually needs.`;

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
    subtasks: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasklistName', 'parentTaskName', 'subtasks'],
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
  } else if (!body.description?.trim()) {
    return `description is required for ${body.mode} mode.`;
  }
  return null;
}

function buildContext(body) {
  const parts = [`Client / project: ${body.projectName ?? '(unspecified)'}`];
  if (body.monthLabel) parts.push(`Month: ${body.monthLabel}`);
  if (body.clientType) parts.push(`Client type: ${body.clientType}`);
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
  const userPrompt = `Project: ${body.projectName ?? '(unspecified)'}

PM's description:
${body.description.trim()}`;

  const raw = await callAnthropic(client, SYSTEM_DESIGN, userPrompt, DESIGN_OUTPUT_SCHEMA);
  // callAnthropic returns parsed.subtasks for the subtasks schema, but for
  // DESIGN_OUTPUT_SCHEMA we get the full object back via a separate path.
  return raw;
}

async function callAnthropic(client, system, userPrompt, schema) {
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

  // Full-design schema — return the whole object.
  if (schema === DESIGN_OUTPUT_SCHEMA) {
    if (!parsed?.tasklistName || !parsed?.parentTaskName || !Array.isArray(parsed?.subtasks)) {
      throw new Error('model returned an unexpected shape');
    }
    return {
      tasklistName: parsed.tasklistName.trim(),
      parentTaskName: parsed.parentTaskName.trim(),
      subtasks: parsed.subtasks.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean),
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
