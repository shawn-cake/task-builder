# Changelog

All notable changes to Task Builder are recorded here.

## Unreleased

### Changed
- App renamed from **Teamwork Task Tool** to **Task Builder**. Updated page
  title, h1, README, and this file.



### Added
- **"Create new project" mode** on the project picker screen. PMs can now spin up
  a brand-new Teamwork project as part of the same flow that adds the initial
  tasklist, parent task, and subtasks. Intended for testing the new "one
  Teamwork project per client, SOW type tracked via tags" organisational
  structure.
  - New segmented control at the top of the picker: "Add to existing project"
    (default, unchanged behavior) vs "Create new project".
  - In "Create new project" mode the form collects a client name (used as the
    project name) and an optional description; the existing template / month /
    client-type / tasklist-mode fields continue to apply as before, except the
    "add to existing tasklist" radio is hidden because the new project has none.
  - Preview now shows the full structure before any write: New project → Tasklist
    → Parent task → Subtasks. Nothing pushes to Teamwork until the PM confirms.
  - Confirmation screen surfaces a direct link to the newly created project in
    Teamwork in addition to the tasklist link.
- New backend route: `POST /api/projects` — creates a Teamwork project via the
  v1 `POST /projects.json` endpoint (v3 doesn't expose project create, mirroring
  the v1 fallback we already use for tasklist creation). Body:
  `{ name, description? }`. Returns `{ id, name, url }`, where `url` comes from
  the response's `Location` header.

### Unchanged
- The existing "add to existing project" path is byte-for-byte unchanged on
  both the frontend and the `/api/create` backend. This release is purely
  additive.
