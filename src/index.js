// Worker entry point.
// Routes /api/* requests to the existing handlers under functions/.
// Everything else falls through to env.ASSETS, which serves the static
// frontend from public/.

import { onRequestGet as getProjects, onRequestPost as createProject } from '../functions/api/projects.js';
import { onRequestGet as getTasklists } from '../functions/api/projects/[projectId]/tasklists.js';
import { onRequestPost as createTasks } from '../functions/api/create.js';
import { onRequestPost as previewSubtasks } from '../functions/api/preview.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/api/projects' && method === 'GET') {
      return getProjects({ request, env });
    }

    if (pathname === '/api/projects' && method === 'POST') {
      return createProject({ request, env });
    }

    const tasklistsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasklists\/?$/);
    if (tasklistsMatch && method === 'GET') {
      return getTasklists({ params: { projectId: tasklistsMatch[1] }, env });
    }

    if (pathname === '/api/create' && method === 'POST') {
      return createTasks({ request, env });
    }

    if (pathname === '/api/preview' && method === 'POST') {
      return previewSubtasks({ request, env });
    }

    // Diagnostic: reports whether env vars resolved at runtime.
    // Reveals only presence + length, never values. Safe to leave in.
    if (pathname === '/api/_diag' && method === 'GET') {
      return Response.json({
        TEAMWORK_DOMAIN: env.TEAMWORK_DOMAIN
          ? { present: true, length: env.TEAMWORK_DOMAIN.length, value: env.TEAMWORK_DOMAIN }
          : { present: false },
        TEAMWORK_API_TOKEN: env.TEAMWORK_API_TOKEN
          ? { present: true, length: env.TEAMWORK_API_TOKEN.length }
          : { present: false },
      });
    }

    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
