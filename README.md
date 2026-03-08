<p align="center">
  <img src="assets/logo.svg" alt="1111" width="80" height="80">
</p>

An agentic learning app that runs entirely in the Chrome side panel. Built by [11:11 Philosopher's Group](https://github.com/1111philo).

## What it does

1111 Learn guides learners through predefined courses using four AI agents powered by the Claude API. Each course produces one final work product. All data stays on the user's device.

### Key features

- **AI-powered learning** -- four Claude agents create personalized plans, generate activities, assess work via screenshots, and track learner progress
- **Course catalog** with prerequisite checking
- **Personalized activity generation** adapted to the learner's profile and prior work
- **AI assessment with vision** -- the Assessment Agent analyzes screenshots of your work and provides structured feedback with strengths, improvements, score, and a recommendation
- **Output validation** -- deterministic validators check every agent response for safety, format compliance, and activity constraints (browser-only, single page, etc.) before showing it to the learner
- **Learner profile** -- tracks your strengths, weaknesses, preferences, and learning patterns across courses; updated after assessments and feedback
- **Activity feedback** -- submit feedback on any activity to regenerate it while keeping the same learning goal
- **Draft recording** -- captures a screenshot of the active tab, the page URL, and AI-generated feedback
- **Iterative feedback** -- each activity builds on prior drafts and feedback
- **Final assessment** -- the final work product must meet a minimum passing threshold
- **Portfolio** -- work cards show progress bars and recording counts; tap into a Build Detail view with full draft timeline and on-demand screenshots
- **Build narrative** -- activity type labels (Research, Practice, Draft, Deliver) and a completion summary card celebrate your process
- **Developer mode** -- toggle in Settings to log all agent requests, responses, feedback, and errors; included in JSON export. When enabled, usage telemetry including agent prompts and responses is sent to help improve the extension (no screenshots or API keys)
- **JSON export** -- export all saved data (metadata + screenshots + dev logs) at any time
- **Keyboard shortcuts** -- Enter submits inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs
- **Fully local** -- screenshots are stored in IndexedDB; metadata in `chrome.storage.local`. Only API calls to Anthropic are made (with the user's own key).
- **Accessible** -- keyboard-operable, screen-reader-friendly, respects `prefers-reduced-motion` and `forced-colors`
- **Lightweight** -- vanilla JS, no frameworks, no build step; designed for Chromebooks and Android tablets

## Install (developer mode)

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Click the 1111 extension icon to open the side panel.
6. Go to **Settings** and enter your Anthropic API key.

## File structure

```
manifest.json            Chrome extension manifest (Manifest V3)
background.js            Opens the side panel on icon click
sidepanel.html           Main UI entry point
sidepanel.css            Styles
js/
  app.js                 App shell, routing, views, event handling
  storage.js             chrome.storage.local + IndexedDB abstraction
  courses.js             Course loading and prerequisite checking
  api.js                 Anthropic API client
  orchestrator.js        Agent orchestration + output validation
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
```

## Releases

Releases are automated via GitHub Actions. Every push to `main` triggers the release workflow:

1. Commits since the last release are analyzed by Claude to determine the appropriate semver bump and generate release notes.
2. `manifest.json` is updated with the new version.
3. The extension is packaged into a zip (ready for Chrome Web Store upload).
4. A GitHub Release is created with the zip attached.

Maintainers must add an `ANTHROPIC_API_KEY` secret to the repository settings for the workflow to function.

## Agent architecture

| Agent | Model | Purpose |
|-------|-------|---------|
| Course Creation | `claude-haiku-4-5` | Generates a personalized learning plan from course objectives |
| Activity Creation | `claude-haiku-4-5` | Fills in detailed instructions for one activity at a time |
| Activity Assessment | `claude-sonnet-4-6` | Evaluates screenshots with vision + provides structured feedback |
| Learner Profile | `claude-haiku-4-5` | Incrementally updates learner profile after assessments and feedback |

Agent prompts are stored as markdown files in `prompts/` and can be edited without changing code. All activity and assessment outputs are validated before reaching the user.

## Course JSON structure

Each course in `data/courses.json` has:

| Field               | Type       | Description                                      |
|---------------------|------------|--------------------------------------------------|
| `courseId`           | `string`   | Unique identifier                                |
| `name`              | `string`   | Display title                                    |
| `description`       | `string`   | Summary of purpose and expected value            |
| `dependsOn`         | `string?`  | Optional prerequisite course ID                  |
| `learningObjectives`| `string[]` | Outcome statements the course achieves           |

## Permissions

| Permission        | Why                                              |
|-------------------|--------------------------------------------------|
| `sidePanel`       | Run the app in the Chrome side panel             |
| `storage`         | Persist metadata locally                         |
| `unlimitedStorage`| Allow large screenshot storage in IndexedDB      |
| `activeTab`       | Capture screenshots and read the active tab URL  |
| `tabs`            | Query tab information for draft recording        |

### Host permissions

| Host                        | Why                                    |
|-----------------------------|----------------------------------------|
| `https://api.anthropic.com/*` | Send requests to the Claude API with the user's own key |
| `https://czrqy8ea0a.execute-api.us-east-1.amazonaws.com/*` | Send anonymous telemetry when dev mode is enabled |
| `<all_urls>`                | Capture screenshots of the active tab for AI assessment |

## License

Copyright (C) 2026 11:11 Philosopher's Group

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
