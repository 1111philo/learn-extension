# Contributing to 1111 Learn

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Fork and clone the repository.
2. Load the extension in Chrome using developer mode (see README.md).
3. Go to Settings and enter your Anthropic API key.
4. Make your changes and test them in the side panel.

## Development workflow

- There is no build step. Edit the source files directly and reload the extension in `chrome://extensions`.
- All source is vanilla JS (ES modules), CSS, and HTML.
- Course definitions live in `data/courses.json`.
- Agent system prompts live in `prompts/*.md` -- edit these to change agent behavior without touching code.
- Enable **Developer mode** in Settings > Data Management to log all agent interactions. Export the JSON to inspect agent requests, responses, and errors.

## Architecture

The app uses four AI agents orchestrated through `js/orchestrator.js`:

1. **Course Creation Agent** -- generates a learning plan skeleton
2. **Activity Creation Agent** -- generates detailed instructions per activity
3. **Activity Assessment Agent** -- evaluates screenshots with vision
4. **Learner Profile Agent** -- tracks learner progress, patterns, and preferences

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
- **Local-first.** The only external calls are to the Anthropic API using the user's own key. Do not add code that sends user data elsewhere.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update README.md and CLAUDE.md accordingly.
- **Test prompts.** When editing `prompts/*.md`, test with a real API key to verify the agent returns valid JSON.

## Submitting changes

1. Create a branch from `main`.
2. Make focused, well-described commits.
3. Open a pull request with a clear summary of what changed and why.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
