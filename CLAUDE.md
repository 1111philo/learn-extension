# CLAUDE.md -- 1111

## Project overview
1111 is a Chrome extension (Manifest V3, side panel) that guides learners through predefined courses using four AI agents powered by the Claude API. The user provides their own Anthropic API key. All data is stored locally using `chrome.storage.local` for metadata and IndexedDB for binary assets (screenshots).

## Architecture
Four agents drive the learning experience:
- **Course Creation Agent** (`MODEL_LIGHT`) -- generates a personalized learning plan skeleton
- **Activity Creation Agent** (`MODEL_LIGHT`) -- fills in one activity at a time as the learner reaches it
- **Activity Assessment Agent** (`MODEL_HEAVY` + vision) -- evaluates screenshots of learner work
- **Learner Profile Agent** (`MODEL_LIGHT`) -- incrementally updates the learner profile after each assessment

Agent prompts live in `prompts/*.md` and can be edited independently of code.

## Key conventions
- All source is vanilla JS (ES modules), CSS, and HTML -- no build step, no frameworks.
- Course definitions live in `data/courses.json`.
- The app entry point is `sidepanel.html`, which loads `js/app.js` as a module.
- Storage is abstracted in `js/storage.js` (chrome.storage.local for metadata, IndexedDB for screenshots).
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `chrome.runtime.getURL`.

## File structure
```
manifest.json            Chrome extension manifest (MV3)
background.js            Opens the side panel on icon click
sidepanel.html           Main UI entry point
sidepanel.css            Styles
js/
  app.js                 App shell, routing, views, event handling
  storage.js             chrome.storage.local + IndexedDB abstraction
  courses.js             Course loading and prerequisite checking
  api.js                 Anthropic API client (fetch wrapper)
  orchestrator.js        Agent orchestration (prompt loading, context assembly, model routing)
prompts/
  course-creation.md     System prompt for Course Creation Agent
  activity-creation.md   System prompt for Activity Creation Agent
  activity-assessment.md System prompt for Activity Assessment Agent
  learner-profile-update.md  System prompt for Learner Profile Agent
data/
  courses.json           Predefined course definitions
```

## Rules for every change
1. Update README.md if you add, remove, or rename any user-facing feature, file, permission, or install step.
2. Update CONTRIBUTING.md if you change the development workflow.
3. Keep this CLAUDE.md in sync with the actual file structure and architecture.
4. If you add a new course field, update the "Course JSON structure" section in README.md.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
6. When editing agent prompts, test with a real API key to verify JSON output format.
7. Never commit API keys or secrets.
