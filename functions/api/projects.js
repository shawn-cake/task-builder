// GET /api/projects?search=<term>
// Returns active Teamwork projects, optionally filtered by name.
// Secrets stay on the server — the browser never sees TEAMWORK_API_TOKEN.

export async function onRequestGet({ request, env }) {
  const { TEAMWORK_DOMAIN, TEAMWORK_API_TOKEN } = env;
  if (!TEAMWORK_DOMAIN || !TEAMWORK_API_TOKEN) {
    return Response.json(
      { error: 'Server not configured (missing TEAMWORK_DOMAIN or TEAMWORK_API_TOKEN).' },
      { status: 500 }
    );
  }

  const search = new URL(request.url).searchParams.get('search')?.trim() ?? '';

  const tw = new URL(`https://${TEAMWORK_DOMAIN}/projects/api/v3/projects.json`);
  tw.searchParams.set('pageSize', '25');
  tw.searchParams.set('projectStatuses', 'active,current');
  tw.searchParams.set('orderBy', 'name');
  if (search) tw.searchParams.set('searchTerm', search);

  const auth = btoa(`${TEAMWORK_API_TOKEN}:x`);
  const res = await fetch(tw.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    return Response.json(
      { error: 'Teamwork API error', upstreamStatus: res.status },
      { status: res.status === 401 ? 502 : res.status }
    );
  }

  const data = await res.json();
  const projects = (data.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    subStatus: p.subStatus,
  }));

  return Response.json({
    projects,
    total: data.meta?.page?.count ?? projects.length,
  });
}
