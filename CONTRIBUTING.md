# Contributing to 1111 Learn

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Fork and clone the repository.
2. Copy `.env.example.js` to `.env.js` and fill in your Anthropic API key and name. This file is gitignored and will never be committed. On app load, these values automatically seed storage — but the onboarding wizard still runs on first use. To skip onboarding in development, complete it once (or clear `chrome.storage.local` and let the seeded key pre-fill the API key step). To reset and re-run onboarding, clear `chrome.storage.local` and remove the `onboardingComplete` flag.
3. Load the extension in Chrome using developer mode (see README.md).
4. Make your changes and test them in the side panel.

## Development workflow

- There is no build step. Edit the source files directly and reload the extension in `chrome://extensions`.
- All source is vanilla JS (ES modules), CSS, and HTML.
- Course definitions live in `data/courses.json`.
- Agent system prompts live in `prompts/*.md` -- edit these to change agent behavior without touching code.
- `.env.js` seeds your API key and name into storage on every load (values only written if not already set). The onboarding wizard still runs regardless — it is controlled by the `onboardingComplete` storage flag, not by whether a key is present. This lets you develop against a pre-seeded key while still exercising the onboarding flow.
- Enable **Share data with 11:11** in Settings > Data Management to log all agent interactions locally and send anonymous telemetry to `learn-service`. A consent notice explains what is and isn't sent. Export the JSON to inspect agent requests, responses, and errors.

## Architecture

The app uses six AI agents orchestrated through `js/orchestrator.js`:

1. **Onboarding Profile Agent** -- creates an inspiring initial learner profile from name and personal statement
2. **Diagnostic Agent** -- generates a skills check activity before every new course
3. **Course Creation Agent** -- generates a learning plan skeleton, informed by the diagnostic result
4. **Activity Creation Agent** -- generates detailed instructions per activity
5. **Activity Assessment Agent** -- evaluates screenshots with vision
6. **Learner Profile Agent** -- tracks learner progress, patterns, and preferences; updated after diagnostics too

All activity and assessment outputs pass through deterministic validators before reaching the user. Validators check for format compliance, safety, and activity constraints (browser-only, single page, ends with "Record").

See `js/api.js` for the API client and model constants.

## Activity constraints

Activities must:
- Happen entirely in the browser tab (the screenshot only captures the active tab)
- Lead to exactly one visible result on one page
- End with "Hit Record to capture your screen."
- Not reference desktop apps, terminals, or file system operations
- Not use platform-specific keyboard shortcuts
- Take 5 minutes or less

## Guidelines

- **Accessibility is required.** Every interactive element must be keyboard-operable and have an accessible name. Test with a screen reader when adding UI.
- **Keep it lightweight.** No frameworks, no heavy dependencies. The app must perform well on Chromebooks and Android tablets.
- **Local-first.** External calls go to the Anthropic API (user's own key) and, when data sharing is enabled, anonymous telemetry to `learn-service`. Screenshots and API keys are never sent, but feedback text the user writes may be included. A consent dialog is shown before enabling data sharing.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update README.md and CLAUDE.md accordingly.
- **Test prompts.** When editing `prompts/*.md`, test with a real API key to verify the agent returns valid JSON.

## Submitting changes

1. Create a branch from `main`.
2. Make focused, well-described commits.
3. Open a pull request with a clear summary of what changed and why.

## Versioning and releases

Versioning is fully automated. When a PR is merged (or a commit is pushed) to `main`, a GitHub Actions workflow:
1. Analyzes the new commits with Claude to determine the semver bump (patch, minor, or major) and generate release notes.
2. Updates the `version` field in `manifest.json`.
3. Packages the extension into a zip and creates a GitHub Release.

**Do not manually bump the version in `manifest.json`** -- the workflow handles this automatically.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
