# Teamwork Task Tool

Internal tool for generating structured Teamwork tasklists, parent tasks, and subtasks from a curated template library. AI handles wording customization; the tool pushes to the Teamwork API after a PM previews and confirms.

## Stack

- **Frontend:** plain HTML/CSS/JS, no build step
- **Backend:** Cloudflare Pages Functions (serverless, runs on Workers runtime)
- **AI:** Anthropic API (Claude) for wording customization
- **Tasks:** Teamwork REST API (v3 for reads + task/subtask creates, v1 for tasklist creates)
- **Hosting:** Cloudflare Pages, one deployed URL for the whole team

## Project layout

```
public/                  Static assets served as-is
  index.html             Single-page UI
  styles.css
  app.js
functions/api/           Cloudflare Pages Functions — server-only code
  projects.js            GET /api/projects?search=...
.dev.vars.example        Template for local secrets (copy to .dev.vars)
```

## Local development

Requirements: Node 18+.

```bash
# 1. Install dev dependency (Wrangler)
npm install

# 2. Copy the env template and fill in real values
cp .dev.vars.example .dev.vars
# then edit .dev.vars

# 3. Start the dev server
npm run dev
```

Wrangler serves the `public/` directory and runs `functions/` as serverless endpoints at `http://localhost:8788`.

## Secrets

All credentials are server-side only and **never appear in committed code, frontend JS, or browser network requests**. They are stored as:

- **Locally:** `.dev.vars` (gitignored), loaded automatically by Wrangler.
- **Production:** Cloudflare Pages dashboard → Settings → Environment variables.

Variables:

| Name | Purpose |
|---|---|
| `TEAMWORK_DOMAIN` | Teamwork host, e.g. `my.cakewebsites.com` |
| `TEAMWORK_API_TOKEN` | Personal API token, used as HTTP Basic username |
| `ANTHROPIC_API_KEY` | Anthropic API key for wording customization |

## Deployment

Cloudflare Pages auto-deploys from this GitHub repo's `main` branch. First-time setup happens once in the Cloudflare dashboard:

1. Create a Pages project, connect this repo, set build output directory to `public`.
2. Add the three environment variables above under Settings → Environment variables.
3. Future pushes to `main` deploy automatically.
