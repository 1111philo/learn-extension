# CLAUDE.md -- 1111 Learn

## Project overview
1111 Learn is a Chrome extension (Manifest V3, side panel) that guides learners through predefined courses using four AI agents powered by the Claude API. The user provides their own Anthropic API key. All data is stored locally using `chrome.storage.local` for metadata and IndexedDB for binary assets (screenshots).

## Architecture
Four agents drive the learning experience:
- **Course Creation Agent** (`MODEL_LIGHT`) -- generates a personalized learning plan skeleton
- **Activity Creation Agent** (`MODEL_LIGHT`) -- fills in one activity at a time as the learner reaches it
- **Activity Assessment Agent** (`MODEL_HEAVY` + vision) -- evaluates screenshots of learner work
- **Learner Profile Agent** (`MODEL_LIGHT`) -- incrementally updates the learner profile after assessments and learner feedback

Agent prompts live in `prompts/*.md` and can be edited independently of code.

### Output validation
All activity and assessment outputs pass through deterministic validators in `js/orchestrator.js` before reaching the user. Activities are checked for: ending with "Record", max 4 steps, no platform-specific shortcuts, no multi-site instructions, no non-browser apps, and content safety. Assessments are checked for valid score/recommendation/fields and safety. On failure, the agent call is retried once automatically.

### Learner profile updates
The profile updates after both assessments and learner feedback. A code-level `mergeProfile()` in `app.js` unions array fields and merges preferences so agent responses can never accidentally lose accumulated data.

### Telemetry
When dev mode is enabled, `js/telemetry.js` buffers usage events and sends them to `learn-service` (separate repo). Events include full agent I/O (prompts, responses, feedback) for debugging and improvement. Screenshots and API keys are never sent. A consent notice is shown when enabling dev mode. The telemetry client is fire-and-forget and never blocks the UI. Service credentials are stored in `chrome.storage.local` under `serviceCredentials`.

## Key conventions
- All source is vanilla JS (ES modules), CSS, and HTML -- no local build step, no frameworks. CI packages the extension into a zip on push to `main`.
- Course definitions live in `data/courses.json`.
- The app entry point is `sidepanel.html`, which loads `js/app.js` as a module.
- Storage is abstracted in `js/storage.js` (chrome.storage.local for metadata, IndexedDB for screenshots).
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `chrome.runtime.getURL`.
- Activities must happen entirely in the browser tab (screenshot capture only sees the active tab).
- All activities end with "Hit Record to capture your screen."
- Keyboard shortcuts: Enter submits single-line inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs.
- URLs in activity instructions are automatically linkified.
- Views: `courses`, `course`, `work` (portfolio cards), `work-detail` (build timeline), `settings`.
- Activity types map to user labels: `explore`→Research, `apply`→Practice, `create`→Draft, `final`→Deliver.
- Work section shows portfolio cards with segmented progress bars; tapping opens a Build Detail view with full draft timeline and on-demand screenshot loading from IndexedDB.
- Completion summary card shows stats (steps, recordings, days) when a course finishes.

## CI/CD
A GitHub Actions workflow (`.github/workflows/release.yml`) runs on every push to `main`:
1. Collects commits since the last release tag
2. Calls Claude (Haiku) to determine the semver bump and generate release notes
3. Updates `manifest.json` version
4. Packages the extension into a zip (excluding dev files)
5. Commits the version bump and creates a GitHub Release with the zip attached

The workflow requires an `ANTHROPIC_API_KEY` secret in the repo settings.

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
  orchestrator.js        Agent orchestration (prompt loading, context assembly, model routing, output validation)
  telemetry.js           Anonymous usage telemetry (opt-in via dev mode)
prompts/
  course-creation.md     System prompt for Course Creation Agent
  activity-creation.md   System prompt for Activity Creation Agent
  activity-assessment.md System prompt for Activity Assessment Agent
  learner-profile-update.md  System prompt for Learner Profile Agent
data/
  courses.json           Predefined course definitions
assets/
  icon.png               Source icon
  icon-{16,32,48,128}.png  Resized icons for Chrome
  logo.svg               Logo for README
.github/
  workflows/
    release.yml          Auto-versioning and release on push to main
```

## Rules for every change
1. Update README.md if you add, remove, or rename any user-facing feature, file, permission, or install step.
2. Update CONTRIBUTING.md if you change the development workflow.
3. Keep this CLAUDE.md in sync with the actual file structure and architecture.
4. If you add a new course field, update the "Course JSON structure" section in README.md.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
6. When editing agent prompts, test with a real API key to verify JSON output format.
7. Never commit API keys or secrets.
8. Activities must be completable entirely in the browser -- never reference desktop apps, terminals, or file system operations.
9. Do not manually bump the version in `manifest.json` -- the CI/CD workflow handles versioning automatically on push to `main`.
