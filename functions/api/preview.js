// POST /api/preview
//
// Two modes:
//   - mode: "tune"      → take the 9 default subtasks + form context + PM's
//                         wording notes, return the same N subtasks with
//                         wording adjusted only as the notes warrant.
//   - mode: "generate"  → take a free-form description + form context,
//                         return N freshly composed subtasks.
//
// Model: Claude Haiku 4.5 — cheapest and fastest model that handles short-text
// rewording well. Calls go through the official @anthropic-ai/sdk; the API
// key never leaves the Worker.
//
// On AI failure in tune mode we fall back to the supplied defaults so the
// user can still proceed. Generate mode has no fallback — there's nothing
// to fall back to.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_TUNE = `You help internal project managers at a marketing agency customize the subtask wording for a recurring tasklist in their project management tool. Your output is internal PM-facing operational text, not customer-facing copy.

Rules:
- Return EXACTLY the same number of subtasks as you receive, in the same order. Never add or remove subtasks — only adjust wording.
- Only change a subtask's wording if the PM's notes give a concrete reason. If a subtask doesn't need changes, return it verbatim.
- If a subtask references something the client doesn't have (e.g., notes say "no specials page"), keep the subtask but adjust the wording to acknowledge that — e.g., "Update specials page if applicable; otherwise skip." Do not drop the subtask.
- Preserve "[Project manager]" prefixes and any other bracketed conventions.
- Keep wording crisp and action-oriented; this is internal text, not client-facing.`;

const SYSTEM_GENERATE = `You help internal project managers at a marketing agency compose a tasklist for a recurring or one-off marketing campaign. Your output is internal PM-facing operational text.

Rules:
- Produce a clean ordered list of subtasks that captures the work end-to-end.
- Typical campaigns have 5-12 subtasks. Don't pad to hit a number; output as many as the work actually needs.
- Each subtask is a single concrete action, written as an imperative ("Send X", "Tag Y for review", "Update Z").
- Use "[Project manager]" prefix only for tasks that explicitly require the PM (e.g., client communication).
- Don't include dates, assignees, or tags — those are handled separately by the tool.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    subtasks: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['subtasks'],
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

  try {
    const subtasks =
      body.mode === 'tune'
        ? await tune(client, body)
        : await generate(client, body);
    return Response.json({ subtasks, mode: body.mode });
  } catch (err) {
    if (body.mode === 'tune') {
      // Fall back to whatever the client sent so the user can still proceed.
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
  if (!['tune', 'generate'].includes(body.mode)) {
    return 'mode must be "tune" or "generate".';
  }
  if (body.mode === 'tune') {
    if (!Array.isArray(body.subtasks) || body.subtasks.length === 0) {
      return 'subtasks must be a non-empty array for tune mode.';
    }
    if (body.subtasks.some((s) => typeof s !== 'string')) {
      return 'every subtask must be a string.';
    }
  } else if (!body.description?.trim()) {
    return 'description is required for generate mode.';
  }
  return null;
}

function buildContext(body) {
  return `Client / project: ${body.projectName ?? '(unspecified)'}
Month: ${body.monthLabel ?? '(unspecified)'}
Client type: ${body.clientType ?? '(unspecified)'}`;
}

async function tune(client, body) {
  const userPrompt = `${buildContext(body)}

Default subtasks (in order):
${body.subtasks.map((s, i) => `${i + 1}. ${s}`).join('\n')}

PM's notes for this run:
${body.notes?.trim() || '(no notes — return the subtasks unchanged)'}`;

  return await callAnthropic(client, SYSTEM_TUNE, userPrompt);
}

async function generate(client, body) {
  const userPrompt = `${buildContext(body)}

Describe what this tasklist should accomplish:
${body.description.trim()}`;

  return await callAnthropic(client, SYSTEM_GENERATE, userPrompt);
}

async function callAnthropic(client, system, userPrompt) {
  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    output_config: {
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  // With output_config.format=json_schema the model returns one text block
  // whose body is the JSON object. Concatenate any text blocks and parse.
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
  if (!parsed || !Array.isArray(parsed.subtasks)) {
    throw new Error('model returned an unexpected shape');
  }
  return parsed.subtasks
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
}
