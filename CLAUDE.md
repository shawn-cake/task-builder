# Cake Task Builder

Internal tool for Cake agency project managers to create Teamwork tasks from client emails or descriptions. PMs paste a client email (or write their own description), the AI generates a tasklist with a parent task and subtasks, and the PM reviews/edits before publishing directly to Teamwork.

## Stack

- **Runtime**: Cloudflare Workers (via Wrangler)
- **Frontend**: Vanilla JS, single-page state machine — no framework, no build step
- **AI**: Anthropic Claude (Haiku) via `@anthropic-ai/sdk` — runs server-side in the Worker
- **Project management**: Teamwork API (v1 for tasklists, v3 for tasks)

## Local dev

```bash
npm run dev    # starts wrangler dev server at localhost:8787
npm run deploy # deploys to Cloudflare
```

Secrets live in `.dev.vars` (gitignored). Copy `.dev.vars.example` and fill in:

```
ANTHROPIC_API_KEY=...
TEAMWORK_API_TOKEN=...
```

`TEAMWORK_DOMAIN` is set in `wrangler.jsonc` vars (not a secret).

## Key files

| File | Purpose |
|------|---------|
| `public/index.html` | 4-screen UI: pick project → configure → preview → success |
| `public/app.js` | All frontend logic — state machine, API calls, rendering |
| `public/styles.css` | All styles |
| `src/index.js` | Worker entry point — routes `/api/*` to function handlers |
| `functions/api/projects.js` | GET/POST Teamwork projects |
| `functions/api/projects/[projectId]/tasklists.js` | GET tasklists for a project |
| `functions/api/preview.js` | Anthropic AI — tune/generate/design subtasks |
| `functions/api/create.js` | Creates tasklist + parent task + subtasks in Teamwork |

## Architecture

The app is a 4-step wizard:
1. **Pick project** — search existing Teamwork projects or create new
2. **Configure** — choose template (AI Generate, Email Campaign, SEO Blog Content) and fill details
3. **Preview** — review and edit AI-generated tasklist, parent task, subtasks, and descriptions before committing
4. **Success** — shows Teamwork links to what was created

### Templates
- **AI Generate** (default) — accepts a raw client email or free-form description; AI produces the full tasklist name, parent task, subtasks, and optional descriptions
- **Email Campaign / SEO Blog Content** — fixed hardcoded subtask lists with optional AI "tune" pass when the PM adds wording notes

### AI modes (`/api/preview`)
- `design` — full generation from description/email → tasklist name + parent task + subtasks + descriptions
- `tune` — adjusts wording of fixed template subtasks based on PM notes
- `generate` — produces subtasks only from a description (used by regenerate panel)

### Teamwork API notes
- Tasklist creation uses the **v1** endpoint (`/projects/:id/tasklists.json`) — v3 returns 405
- Task and subtask creation uses **v3** (`/projects/api/v3/...`)
- Subtasks are created sequentially — the API rejects parallel writes from the same token
- Task descriptions are passed as the `description` field on the task object (plain text or HTML)

## Conventions
- No TypeScript, no bundler — keep it simple; the Worker runtime handles ES modules natively
- `state` in `app.js` is the single source of truth for all UI state
- `state.preview.subtasks` is an array of `{ name, description }` objects
- AI output is always validated against a JSON schema before use
- Partial Teamwork failures are surfaced to the user — never silently swallowed
