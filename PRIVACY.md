# Privacy Policy

**1111 Learn** -- Chrome Extension
**Data Controller:** 11:11 Philosopher's Group
**Last Updated:** 2026-03-08

---

## 1. Overview

1111 Learn is a Chrome extension that guides learners through courses using AI agents powered by the Claude API. This privacy policy explains what data is collected, how it is used, and your rights regarding that data.

**In short:** your learning data stays on your device by default. We only collect anonymous telemetry if you explicitly opt in.

## 2. Data Stored Locally (Never Shared)

All core learning data is stored entirely on your device using Chrome's local storage and IndexedDB. This data never leaves your browser unless you choose to export it yourself.

| Data | Storage | Purpose |
|------|---------|---------|
| Your name and personal statement (entered at onboarding) | `chrome.storage.local` | Create your initial learner profile and personalize the experience |
| Course progress and activity history | `chrome.storage.local` | Track your learning journey |
| Screenshots of your work | IndexedDB | AI assessment of your drafts |
| Learner profile (strengths, weaknesses, preferences, goal) | `chrome.storage.local` | Personalize future activities and course plans |
| Your Anthropic API key | `chrome.storage.local` | Authenticate API calls to Anthropic |
| Settings and preferences | `chrome.storage.local` | Remember your configuration |

We have no access to this data. It exists only on your device.

## 3. Anthropic API Calls

The extension sends requests to the Anthropic API (api.anthropic.com) using **your own API key** to power the four AI agents. These API calls include course context, activity instructions, learner profile data, and screenshots for assessment.

These calls are a direct relationship between you and Anthropic, governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy) and terms of service. 11:11 Philosopher's Group does not have access to your API key or the content of these API calls.

## 4. Optional Data Sharing (Telemetry)

### 4.1 Consent

Data sharing is **off by default**. You must explicitly opt in by enabling the **"Share data with 11:11"** toggle in Settings, which presents a consent dialog. Data collection begins only after you confirm.

Your consent timestamp is recorded locally on your device.

### 4.2 What We Collect

When data sharing is enabled, the following is sent to our telemetry server:

| Data | Purpose |
|------|---------|
| Agent prompts (system prompts sent to the AI) | Identify prompt quality issues |
| AI responses (the agent's output) | Detect patterns in poor outputs |
| Feedback text you write (e.g., activity complaints, dispute text) | Understand why users disagree with AI outputs |
| Assessment scores and recommendations | Track assessment accuracy |
| Activity metadata (course ID, activity type, activity goal) | Contextualize feedback patterns |
| Validation failures and error messages | Fix bugs and improve reliability |
| Extension version | Attribute issues to specific releases |
| Browser platform (e.g., "MacIntel", "Linux x86_64") | Understand device compatibility |
| A random session ID (format: `sess_XXXXXXXXXXXX`) | Group events within a single session |

### 4.3 What We Never Collect

| Data | Why |
|------|-----|
| Screenshots | Binary data is stripped before sending; too large and potentially sensitive |
| Your Anthropic API key | Explicitly blocked in code; would be a security risk |
| Your name | Not included in telemetry events |
| Your email address | We have no mechanism to collect it |
| Your IP address | Our server does not log or store IP addresses |
| Browsing history or tab content | The extension only accesses the active tab for screenshots, which are never sent |

### 4.4 Anonymity

When you first enable data sharing, your device generates a random anonymous user ID (format: `anon_XXXXXXXXXXXXXXXX`) and an API key (format: `ls_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`). These are cryptographically random and cannot be linked to your identity.

Different devices and extension reinstalls generate separate anonymous IDs.

### 4.5 How We Use the Data

Telemetry data is used solely to improve the extension:

- **Prompt improvement:** we analyze disputes (where users disagreed with AI assessment), activity regenerations (where users rejected an activity), and validation failures to identify patterns and improve the AI agent prompts.
- **Bug fixes:** error events help us find and fix issues.
- **Quality metrics:** aggregate statistics (dispute rate, validation failure rate, latency) help us measure overall quality.

We do not sell, share, or transfer telemetry data to any third party. We do not use it for advertising, profiling, or any purpose other than improving 1111 Learn.

### 4.6 Data Storage and Security

- **Server:** telemetry data is stored in AWS DynamoDB in the us-east-1 (N. Virginia) region, accessed via AWS Lambda and API Gateway over HTTPS.
- **Encryption:** all data is encrypted in transit (TLS) and at rest (AWS-managed encryption).
- **Access:** only 11:11 Philosopher's Group maintainers with the admin key can access telemetry data.
- **Retention:** all telemetry events are automatically deleted after **90 days** via DynamoDB's time-to-live (TTL) feature.

### 4.7 Legal Basis for Processing (GDPR)

Our legal basis for processing telemetry data is **consent** (Article 6(1)(a) of the GDPR). You provide this consent by enabling data sharing and confirming the consent dialog.

## 5. Your Rights

Under the GDPR and similar privacy regulations, you have the following rights:

| Right | How to exercise it |
|-------|-------------------|
| **Right to be informed** | This privacy policy provides full transparency about our data practices |
| **Right of access** | Contact us to request a copy of any data associated with your anonymous ID |
| **Right to rectification** | Contact us if you believe collected data is inaccurate |
| **Right to erasure** | Contact us to request deletion of your data, or wait 90 days for automatic deletion |
| **Right to restrict processing** | Disable data sharing in Settings to stop all future collection |
| **Right to withdraw consent** | Turn off the "Share data with 11:11" toggle at any time; this takes effect immediately |
| **Right to object** | Disable data sharing at any time; no reason required |
| **Right to data portability** | Use the JSON export feature in Settings to export all locally stored data |

Note: because telemetry data is anonymous (tied to a random ID, not your identity), we may not be able to identify which data belongs to you without additional information. Your anonymous ID is stored locally on your device under `chrome.storage.local`.

## 6. Children's Privacy

1111 Learn is an educational tool. We do not knowingly collect personal information from children under 13. Since telemetry is anonymous and opt-in, and we collect no personally identifying information, no additional parental consent mechanisms are required. If you believe a child has shared personal information with us through feedback text, please contact us.

## 7. Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in this document with an updated "Last Updated" date. For significant changes to data practices, we will update the consent dialog in the extension.

## 8. Contact

If you have questions, concerns, or requests regarding your data or this privacy policy:

- **Email:** [1111@philosophers.group](mailto:1111@philosophers.group)
- **GitHub:** [Open an issue](https://github.com/1111philo/learn-extension/issues) on our repository
- **Organization:** 11:11 Philosopher's Group -- [philosophers.group](https://philosophers.group)
