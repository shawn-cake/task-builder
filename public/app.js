const searchInput = document.getElementById('search');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');

let debounceTimer = null;
let activeRequestId = 0;

async function loadProjects(term) {
  const requestId = ++activeRequestId;
  setStatus(term ? `Searching for "${term}"…` : 'Loading projects…');

  const url = new URL('/api/projects', window.location.origin);
  if (term) url.searchParams.set('search', term);

  try {
    const res = await fetch(url);
    if (requestId !== activeRequestId) return; // a newer search superseded this one
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(`Error: ${body.error || res.statusText}`, true);
      resultsEl.innerHTML = '';
      return;
    }
    const { projects, total } = await res.json();
    renderResults(projects);
    setStatus(
      projects.length === 0
        ? 'No projects matched.'
        : `Showing ${projects.length} of ${total}.`
    );
  } catch (err) {
    if (requestId !== activeRequestId) return;
    setStatus(`Network error: ${err.message}`, true);
  }
}

function renderResults(projects) {
  resultsEl.innerHTML = '';
  for (const p of projects) {
    const li = document.createElement('li');
    li.dataset.projectId = p.id;
    li.innerHTML = `
      <span class="project-name"></span>
      <span class="project-id"></span>
    `;
    li.querySelector('.project-name').textContent = p.name;
    li.querySelector('.project-id').textContent = `#${p.id}`;
    resultsEl.appendChild(li);
  }
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

searchInput.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  const term = e.target.value.trim();
  debounceTimer = setTimeout(() => loadProjects(term), 200);
});

loadProjects('');
