---
name: run
description: Launch the Cake Task Builder local dev server. Use when the user says run, start, spin up, fire up, open, or test locally. Also triggers on "does it work", "check the UI", "see it in the browser", or "verify the change". Skip if the user is asking to deploy to production — use npm run deploy for that.
---

# Run: Cake Task Builder

## Launch

```bash
npm run dev
```

Starts Wrangler dev server at **http://localhost:8787**. The Worker serves static assets from `public/` and routes `/api/*` to function handlers in `functions/`.

## Prerequisites

Secrets must be present in `.dev.vars` (gitignored). Copy `.dev.vars.example` if it's missing:

```
ANTHROPIC_API_KEY=sk-ant-...
TEAMWORK_API_TOKEN=...
```

`TEAMWORK_DOMAIN` is a non-secret var set in `wrangler.jsonc` — no action needed.

## Common issues

**SQLite locked** — `SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)` on startup means another Wrangler instance is still running (common leftover from a previous session):

```bash
pkill -f wrangler
npm run dev
```

**Port 8787 already in use** — A different process has the port. Find and kill it:

```bash
lsof -ti :8787 | xargs kill -9
npm run dev
```

**Page loads but API calls fail (500s)** — `.dev.vars` is missing or incomplete. The Worker starts fine without it, but every AI or Teamwork call will fail silently. Check that both `ANTHROPIC_API_KEY` and `TEAMWORK_API_TOKEN` are populated in `.dev.vars`.

## Verify it's working

Open http://localhost:8787 — you should see the Task Builder UI at Step 1 (Configure). A working server will load the project list when you reach Step 2.

## Deploy

```bash
npm run deploy
```

Deploys to Cloudflare Workers. Secrets for production are set via `wrangler secret put` or the Cloudflare dashboard — not from `.dev.vars`.
