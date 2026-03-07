# CLAUDE.md — learn-extension

## Project overview
1111 is a Chrome extension (Manifest V3, side panel) that guides learners through predefined courses. It stores all data locally using `chrome.storage.local` for metadata and IndexedDB for binary assets (screenshots). No data is sent to any remote server.

## Key conventions
- All source is vanilla JS (ES modules), CSS, and HTML — no build step, no frameworks.
- Course definitions live in `data/courses.json`.
- The app entry point is `sidepanel.html`, which loads `js/app.js` as a module.
- Storage is abstracted in `js/storage.js` (chrome.storage.local for metadata, IndexedDB for screenshots).

## Rules for every change
1. Update README.md if you add, remove, or rename any user-facing feature, file, permission, or install step.
2. Update CONTRIBUTING.md if you change the development workflow.
3. Keep this CLAUDE.md in sync with the actual file structure and architecture.
4. If you add a new course field, update the "Course JSON structure" section in README.md.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
