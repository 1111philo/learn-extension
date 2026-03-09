# 1111 Learn Creator — Product Requirements Document

## WordPress Plugin for AI-Powered Course Content Creation

**Version:** 0.2.0-draft
**Date:** 2026-03-09
**Status:** Draft — awaiting review

---

## 1. Overview

**1111 Learn Creator** is a WordPress plugin that adds a "Learn" custom post type and a "Courses" taxonomy. An administrator enters a course title, description, and learning objectives into a dashboard interface. A four-agent AI pipeline (powered by the Anthropic Claude API) then generates a cohesive course narrative, structured lesson plans, full lesson content, and practice activities — all saved as WordPress posts organized under the appropriate Course taxonomy term.

This plugin is **content-creation only** — it does not include assessments, learner profiles, progress tracking, or any learner-facing interactive features. Those concerns belong to a future companion plugin (1111 Learn Administrator).

### 1.1 Lineage

This plugin adapts proven agent patterns from two existing 1111 projects:

- **1111 Learn** (Chrome extension) — Four-agent architecture: Course Creation → Activity Creation → Activity Assessment → Learner Profile. Prompts stored as Markdown files. Output validated deterministically before reaching the user. Retry-once on validation failure.
- **1111 School** (full-stack web app) — Seven PydanticAI agents with backward design methodology: Course Describer → Lesson Planner → Lesson Writer → Activity Creator → Activity Reviewer → Assessment Creator → Assessment Reviewer. Narrative threading across lessons. Scope control to prevent objective bleed. On-demand lesson generation.

The WordPress plugin takes the best of both: the narrative threading and backward design from School, the Markdown-file prompt editability from Learn, and a pipeline scoped to content creation only.

---

## 2. Goals

1. Let a WordPress administrator create a complete, structured course from three inputs: title, description, and learning objectives.
2. Generate pedagogically sound lesson content using a four-agent pipeline, with prompts stored as editable Markdown files so non-developers can iterate on output quality.
3. Use backward design (define mastery → design evidence → build the path) to ensure lessons and activities are aligned to objectives.
4. Thread a narrative arc across all lessons so the course reads as a coherent journey, not disconnected topics.
5. Produce standard WordPress posts (custom post type `learn`) organized under a `course` taxonomy — compatible with any theme, page builder, or LMS plugin.
6. Keep the plugin self-contained: no build step, no JavaScript framework, no external dependencies beyond the Anthropic API.
7. Meet WCAG 2.1 AA accessibility standards in all admin UI.

---

## 3. User Personas

### 3.1 Course Creator (WordPress Administrator)
- Has WordPress admin access
- Knows the subject matter and can write learning objectives
- May not be technical — needs a simple, guided interface
- Wants to review and edit generated content before publishing

### 3.2 Prompt Editor (Developer or Subject-Matter Expert)
- Edits agent prompts in Markdown files to refine output quality
- Tests prompts outside WordPress with any Claude client
- Does not need to touch PHP to change agent behavior

---

## 4. Architecture

### 4.1 Four-Agent Pipeline

The generation pipeline uses four sequential agents. Each agent's output feeds into the next. This mirrors the proven patterns from 1111 School's generation service, adapted for WordPress.

```
Admin Input (title, description, objectives)
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Agent 1: Course Describer                       │
│  (fast model)                                    │
│  Establishes narrative arc + lesson titles        │
│  Output: narrative_description, lesson_previews   │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  Agent 2: Lesson Planner (per objective)         │
│  (fast model)                                    │
│  Backward design: mastery → activity → outline    │
│  Output: mastery_criteria, activity_seed, outline │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  Agent 3: Lesson Writer (per objective)          │
│  (default model — needs more tokens)             │
│  Writes full lesson content from the plan         │
│  Output: lesson_body, key_takeaways               │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  Agent 4: Activity Creator (per objective)       │
│  (fast model)                                    │
│  Designs practice activity from activity seed     │
│  Output: prompt, instructions, rubric, hints      │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  WordPress Posts (CPT: learn, Taxonomy: course)   │
│                                                   │
│  Course: "Web Accessibility Fundamentals"         │
│    ├── Lesson 1 + Activity (draft)                │
│    ├── Lesson 2 + Activity (draft)                │
│    ├── Lesson 3 + Activity (draft)                │
│    └── Lesson 4 + Activity (draft)                │
└───────────────────────────────────────────────────┘
```

### 4.2 Why Four Agents Instead of Two

The original PRD used two agents (plan + write). After studying the 1111 School pipeline, four agents produce significantly better content because:

1. **Course Describer** ensures narrative coherence — lesson titles feel like chapters in the same story, not isolated topics. Without this, each lesson is planned in isolation and the course lacks an arc.
2. **Lesson Planner** uses backward design — defining mastery criteria first, then designing the activity, then planning the lesson content. This ensures the lesson teaches exactly what the learner needs to succeed at the activity.
3. **Lesson Writer** focuses solely on writing engaging content from a detailed plan, rather than simultaneously planning and writing.
4. **Activity Creator** designs activities anchored to specific mastery criteria, not generic "practice what you learned" exercises.

The incremental cost is minimal (3 fast-model calls + 1 default-model call per objective vs. 2 calls), but the quality improvement is substantial.

### 4.3 Agent Design Principles (from 1111 School)

These principles are proven in production and must carry forward:

- **Backward design:** Define the finish line (mastery criteria) → design the evidence (activity) → plan the path (lesson outline). Never start with content and hope it covers the objective.
- **Narrative threading:** The Course Describer identifies the PRIMARY objective and shows how others support it. Every lesson title and summary feels like a chapter in the same story.
- **Scope control:** Each lesson covers ONLY its assigned objective. The planner receives the full objective list but is explicitly told not to teach other objectives. This prevents scope creep and repetition.
- **Agents are functions, not frameworks:** Each agent takes typed input, returns typed output, validates against a schema, and retries on failure. No memory across invocations, no autonomous decisions.
- **Prompts are data, not code:** System prompts live in Markdown files. Dynamic context (course data, objectives) goes in the user message. Changing agent behavior never requires touching PHP.

### 4.4 Custom Post Type: `learn`

| Property | Value |
|----------|-------|
| Post type slug | `learn` |
| Label (singular) | Lesson |
| Label (plural) | Lessons |
| Public | `true` |
| Has archive | `true` |
| Supports | `title`, `editor`, `excerpt`, `thumbnail`, `custom-fields`, `revisions` |
| Show in REST | `true` (Gutenberg compatible) |
| Menu icon | `dashicons-welcome-learn-more` |
| Menu position | 25 (below Comments) |

### 4.5 Custom Taxonomy: `course`

| Property | Value |
|----------|-------|
| Taxonomy slug | `course` |
| Label (singular) | Course |
| Label (plural) | Courses |
| Hierarchical | `false` (flat, like tags — courses don't nest) |
| Public | `true` |
| Show in REST | `true` |
| Associated post type | `learn` |

---

## 5. Agent Specifications

All agents use the Anthropic Claude API. The admin provides their own API key. System prompts are stored as Markdown files in `prompts/` and loaded at runtime.

### 5.1 Agent 1: Course Describer

**Purpose:** Given a course title, description, and learning objectives, produce a cohesive narrative description and pre-set lesson titles/summaries that thread all objectives into a single arc.

**Model:** Fast model (`claude-haiku-4-5-20251001`)
**Max tokens:** 2048
**Prompt file:** `prompts/course-describer.md`

**Input (user message):**
```
Course title: Web Accessibility Fundamentals

Course description: Learn to identify, evaluate, and address common web accessibility barriers.

Learning objectives (3 total — produce one lesson entry for each):
1. Identify common accessibility barriers on web pages
2. Use browser developer tools to run basic accessibility audits
3. Propose concrete fixes for the accessibility issues you find
```

**Expected output (JSON):**
```json
{
  "narrative_description": "You'll start by learning to see the web through the eyes of users who face accessibility barriers every day — visual, motor, cognitive, and more. With that foundation, you'll pick up the browser tools that reveal these barriers in any webpage's code. By the end, you'll be writing specific, prioritized fix recommendations that developers can act on immediately.",
  "lessons": [
    {
      "lesson_title": "Seeing the Barriers",
      "lesson_summary": "Identify and categorize the most common accessibility barriers users face on the web."
    },
    {
      "lesson_title": "Auditing with Browser Tools",
      "lesson_summary": "Run systematic accessibility audits using built-in browser developer tools."
    },
    {
      "lesson_title": "Writing Fix Recommendations",
      "lesson_summary": "Produce specific, prioritized accessibility fix recommendations that developers can implement."
    }
  ]
}
```

**Key prompt rules (from 1111 School's course_describer):**
- `narrative_description` must identify the PRIMARY objective and show how others support it
- Give the learner a clear arc: where they start, what they build, where they end up
- Written in second person (you/your), energetic and specific
- One lesson entry per objective, in the same order — never merge, skip, or reorder
- Lesson titles must feel like chapters in the same story (foundation → application → mastery)
- Lesson summaries describe what the learner will be able to DO, not what the lesson covers

### 5.2 Agent 2: Lesson Planner

**Purpose:** Given one objective, the course narrative, and the full objective list (for scope control), produce a backward-designed lesson plan: mastery criteria → activity seed → lesson outline.

**Model:** Fast model (`claude-haiku-4-5-20251001`)
**Max tokens:** 2048
**Prompt file:** `prompts/lesson-planner.md`

**Input (user message):**
```
Course description: You'll start by learning to see the web through the eyes of users who face accessibility barriers...

Learning objective for THIS lesson: Identify common accessibility barriers on web pages

This lesson must be titled exactly: Seeing the Barriers

Other objectives in this course (DO NOT teach these, they have their own lessons):
- Use browser developer tools to run basic accessibility audits
- Propose concrete fixes for the accessibility issues you find
```

**Expected output (JSON):**
```json
{
  "lesson_title": "Seeing the Barriers",
  "learning_objective": "Identify and categorize at least five common web accessibility barriers across visual, motor, cognitive, and auditory categories.",
  "key_concepts": [
    "Visual barriers (contrast, color-only indicators, missing alt text)",
    "Motor barriers (small targets, keyboard traps, hover-only interactions)",
    "Cognitive barriers (complex layouts, auto-playing media, inconsistent navigation)",
    "Auditory barriers (missing captions, audio-only content)",
    "WCAG as a framework for categorizing barriers"
  ],
  "mastery_criteria": [
    "Names at least five distinct accessibility barriers with correct categorization",
    "Explains how each barrier affects real users (not just abstract rule violations)",
    "Identifies barriers from at least three different categories (visual, motor, cognitive, auditory)",
    "Uses specific examples rather than generic descriptions"
  ],
  "suggested_activity": {
    "activity_type": "short_answer",
    "prompt": "Visit any popular website and identify at least five accessibility barriers you can find. For each, explain which user group it affects and why.",
    "expected_evidence": [
      "Lists at least five barriers found on the chosen website",
      "Correctly categorizes each barrier",
      "Explains impact on real users for each barrier"
    ]
  },
  "lesson_outline": [
    "Start with a scenario: a user with low vision trying to read a low-contrast form",
    "Define what accessibility barriers are and who they affect",
    "Walk through visual barriers with real-world examples",
    "Cover motor and keyboard barriers with examples",
    "Cover cognitive and auditory barriers with examples",
    "Introduce WCAG as the framework that organizes these barriers",
    "Show how to spot barriers on a real webpage (visual inspection technique)",
    "Recap: the five categories and why recognizing them matters"
  ]
}
```

**Key prompt rules (from 1111 School's lesson_planner):**
- **Backward design order:** Step 1: mastery_criteria (what does mastery look like?), Step 2: suggested_activity (what would demonstrate mastery?), Step 3: lesson_outline (what knowledge closes the gap?)
- **Scope control:** Cover ONLY the assigned objective. May briefly mention related topics for context but must NOT teach concepts belonging to other objectives.
- Mastery criteria must be specific and measurable — rubric-style checks a reviewer could use.
- Activity seed must directly exercise the mastery criteria, not just recall facts.
- Lesson outline must close the gap: after completing it, a learner could plausibly meet every mastery criterion.
- Preset title from Course Describer must be used exactly.

### 5.3 Agent 3: Lesson Writer

**Purpose:** Given the lesson plan (including mastery criteria, activity seed, and outline), write the full lesson content.

**Model:** Default model (`claude-sonnet-4-6` — needs more tokens for long-form content)
**Max tokens:** 8192
**Prompt file:** `prompts/lesson-writer.md`

**Input (user message):**
```
Course description: You'll start by learning to see the web through the eyes of users...

Lesson plan:
{full lesson plan JSON from Agent 2}
```

**Expected output (JSON):**
```json
{
  "lesson_title": "Seeing the Barriers",
  "key_takeaways": [
    "Accessibility barriers fall into four main categories: visual, motor, cognitive, and auditory.",
    "Each barrier affects real people in specific, concrete ways — not just abstract compliance violations.",
    "WCAG provides a systematic framework for identifying and categorizing barriers.",
    "Spotting barriers starts with a visual inspection: check contrast, keyboard access, alt text, and captions."
  ],
  "lesson_body": "## What Are Accessibility Barriers?\n\nImagine trying to fill out a loan application where the form labels are light gray on white..."
}
```

**Key prompt rules (from 1111 School's lesson_writer):**
- Start with a clear statement of the learning objective
- Explain why this topic matters (real-world relevance)
- Walk through key concepts with clear steps and explanations
- Include at least one concrete, worked example
- End with a brief recap tying back to the objective
- The plan includes mastery_criteria and suggested_activity — by the end of the lesson, the learner should have everything they need to attempt the activity and meet each criterion
- Use worked examples that mirror the skill demands of the activity
- Use Markdown: headings (`##`, `###`), lists, code blocks where appropriate
- Teach, don't lecture — clear, engaging voice
- `key_takeaways`: 3–6 short strings (1–2 sentences each). These are stored as post meta, NOT embedded in the lesson body.
- `lesson_body`: Minimum 200 characters. Full Markdown lesson content.

### 5.4 Agent 4: Activity Creator

**Purpose:** Given the activity seed and mastery criteria from the lesson plan, create a complete practice activity with instructions, rubric, and hints.

**Model:** Fast model (`claude-haiku-4-5-20251001`)
**Max tokens:** 1024
**Prompt file:** `prompts/activity-creator.md`

**Input (user message):**
```
Learning objective: Identify common accessibility barriers on web pages

Mastery criteria:
- Names at least five distinct accessibility barriers with correct categorization
- Explains how each barrier affects real users
- Identifies barriers from at least three different categories
- Uses specific examples rather than generic descriptions

Activity seed:
{activity seed JSON from lesson plan}
```

**Expected output (JSON):**
```json
{
  "activity_type": "short_answer",
  "prompt": "Pick any popular website you use regularly. Explore it with accessibility in mind and identify at least five barriers you can find across different categories.",
  "instructions": "For each barrier, name it, categorize it (visual, motor, cognitive, or auditory), and explain in 1-2 sentences how it affects a real user. Aim for 200-400 words total.",
  "scoring_rubric": [
    "Identifies at least five distinct accessibility barriers",
    "Correctly categorizes each barrier into the right category",
    "Explains real user impact for each barrier (not just rule violations)",
    "Covers at least three different barrier categories",
    "Uses specific, concrete examples from the chosen website"
  ],
  "hints": [
    "Try navigating the website using only your keyboard — can you reach everything?",
    "Look at images: do they have alt text you can check in the browser?",
    "Check text contrast: can you read everything easily, especially in smaller sizes?",
    "Look for content that only works on hover or requires precise mouse movements"
  ]
}
```

**Key prompt rules (from 1111 School's activity_creator):**
- `prompt`: Core task question (1–2 sentences, min 20 chars). What the learner reads first — clear and direct.
- `instructions`: Format and constraint guidance ONLY (1–2 sentences, min 50 chars). Do NOT restate the prompt.
- `scoring_rubric`: 3–6 specific, checkable criteria that map to the mastery criteria.
- `hints`: 2–5 scaffolding hints that guide without giving the answer.
- Activity must directly test the learning objective — challenging but achievable.
- Anchor in real-world application, not hypothetical scenarios.

---

## 6. Output Validation

All agent output passes through deterministic validators before reaching WordPress. This pattern is proven in both 1111 Learn (browser-side) and 1111 School (Pydantic schema validation).

### 6.1 Validation Rules

**Course Describer output:**
- `narrative_description` is a non-empty string (min 100 chars)
- `lessons` is an array with exactly one entry per objective
- Each lesson has `lesson_title` (5–60 chars) and `lesson_summary` (min 30 chars)

**Lesson Plan output:**
- Has `lesson_title`, `learning_objective`, `key_concepts` (2–8 items), `mastery_criteria` (2–6 items)
- `suggested_activity` has `activity_type`, `prompt`, `expected_evidence` (2–5 items)
- `lesson_outline` has 3–10 items
- No unsafe content patterns

**Lesson Content output:**
- Has `lesson_title`, `lesson_body` (min 200 chars), `key_takeaways` (3–6 items)
- No unsafe content patterns

**Activity output:**
- Has `prompt` (min 20 chars), `instructions` (min 50 chars)
- `scoring_rubric` has 3–6 items
- `hints` has 2–5 items
- No unsafe content patterns

### 6.2 Retry Strategy

On validation failure, the agent call is retried once automatically (matching both Learn and School patterns). If the retry also fails, the admin sees an error with:
- Which agent failed and why
- A **Retry** button that resumes from the failed step
- Already-generated content is preserved (incremental recovery, per School's design)

### 6.3 Safety Patterns

All text output is checked against unsafe content patterns before saving:

```
/\b(kill yourself|self-harm|suicide method|how to hack|how to steal|how to attack)\b/i
```

Safety violations are never retried — the admin is shown an error and the generation stops.

---

## 7. Plugin File Structure

```
learned-wp-creator/
├── 1111-learn-creator.php          Main plugin file (plugin header, bootstrap)
├── README.md                       Plugin readme (WordPress-style + GitHub)
├── CLAUDE.md                       AI coding assistant instructions
├── LICENSE                         GPL v2+
├── uninstall.php                   Clean removal of plugin data
│
├── includes/
│   ├── class-post-type.php         Registers CPT and taxonomy
│   ├── class-api-client.php        Anthropic API HTTP client
│   ├── class-orchestrator.php      Agent orchestration, pipeline, validation
│   ├── class-admin-page.php        Dashboard page registration and rendering
│   └── class-settings.php          Settings page (API key, model config)
│
├── admin/
│   ├── css/
│   │   └── admin.css               Dashboard styles
│   ├── js/
│   │   └── admin.js                Dashboard interactivity (AJAX, form, progress)
│   └── views/
│       ├── dashboard.php           Course creation form template
│       ├── settings.php            Settings page template
│       └── generating.php          Generation progress template (partial)
│
├── prompts/
│   ├── course-describer.md         System prompt — narrative arc + lesson titles
│   ├── lesson-planner.md           System prompt — backward design lesson plan
│   ├── lesson-writer.md            System prompt — full lesson content
│   └── activity-creator.md         System prompt — practice activity design
│
└── assets/
    └── icon.svg                    Plugin icon / branding
```

---

## 8. Admin Dashboard UI

### 8.1 Top-Level Menu

- **Menu title:** 1111 Learn
- **Icon:** `dashicons-welcome-learn-more`
- **Submenu items:**
  - **Dashboard** — Course creation form
  - **All Lessons** — Standard CPT list view (WordPress default)
  - **Courses** — Taxonomy management (WordPress default)
  - **Settings** — API key and model configuration

### 8.2 Dashboard Page — Course Creation Form

**Fields:**

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Course Title | Text input | Required, max 200 chars | Becomes the taxonomy term name |
| Course Description | Textarea | Required, 10–1000 chars | Stored as taxonomy term description and passed to agents |
| Learning Objectives | Repeater (text inputs) | Min 1, max 8 items; each max 300 chars | Each objective is a measurable learning outcome |

**Objective count follows 1111 School's range:** 1–8 objectives (School uses 1–8 in its validation). Each objective produces one lesson.

**Interaction flow:**

1. Admin fills in the three fields and clicks **Generate Course**.
2. Form validates client-side. If invalid, inline errors appear next to fields.
3. On valid submission, an AJAX request sends data to the server.
4. The dashboard shows a **vertical stepper** progress view (matching School's generation UX):
   - Phase 0: "Establishing course narrative..." → shows lesson titles as they arrive
   - Per objective: "Planning lesson 1..." → "Writing lesson 1..." → "Creating activity 1..." (checkmarks on completion)
   - Overall: "Generation complete — N lessons created"
5. On completion, a success message with links to:
   - Edit individual lessons in the block editor
   - View the course archive page
   - Return to dashboard to create another course
6. On error per objective: displayed inline in the stepper without blocking other objectives
7. On fatal error: error message with **Retry** button that resumes from the last successful step

### 8.3 Settings Page

| Field | Type | Notes |
|-------|------|-------|
| Anthropic API Key | Password input | Stored encrypted in `wp_options`. Masked in UI. |
| Fast Model | Select | Default: `claude-haiku-4-5-20251001`. Used by Describer, Planner, Activity Creator. |
| Default Model | Select | Default: `claude-sonnet-4-6`. Used by Lesson Writer (needs more tokens). |
| Max Tokens (Plan) | Number | Default: 2048. Range: 512–4096. |
| Max Tokens (Content) | Number | Default: 8192. Range: 1024–16384. |

Settings are saved using the WordPress Settings API with nonce verification and capability checks.

---

## 9. Data Model

### 9.1 Taxonomy Term Meta (Course)

| Meta key | Type | Description |
|----------|------|-------------|
| `_1111_learning_objectives` | `array` | Original learning objectives entered by admin |
| `_1111_course_description` | `string` | Original course description |
| `_1111_narrative_description` | `string` | AI-generated narrative arc from Course Describer |
| `_1111_lesson_titles` | `array` | Pre-set `[{lesson_title, lesson_summary}]` from Course Describer |
| `_1111_generation_date` | `string` | ISO 8601 timestamp of generation |
| `_1111_generation_status` | `string` | `generating`, `complete`, `failed` |

### 9.2 Post Meta (Lesson)

| Meta key | Type | Description |
|----------|------|-------------|
| `_1111_objective_index` | `int` | Zero-based index into the course's learning objectives |
| `_1111_lesson_order` | `int` | Sort order within the course (0-based) |
| `_1111_learning_objective` | `string` | Measurable objective from lesson plan |
| `_1111_key_concepts` | `array` | Key concepts from lesson plan |
| `_1111_mastery_criteria` | `array` | Mastery criteria from lesson plan |
| `_1111_key_takeaways` | `array` | Key takeaways from lesson writer |
| `_1111_activity` | `array` | Activity spec: `{activity_type, prompt, instructions, scoring_rubric, hints}` |
| `_1111_lesson_plan_raw` | `array` | Full raw lesson plan (for debugging/re-generation) |
| `_1111_generated` | `bool` | `true` if AI-generated |

### 9.3 Options (wp_options)

| Option key | Description |
|------------|-------------|
| `1111_learn_api_key` | Encrypted Anthropic API key |
| `1111_learn_fast_model` | Model ID for Describer, Planner, Activity Creator |
| `1111_learn_default_model` | Model ID for Lesson Writer |
| `1111_learn_plan_max_tokens` | Max tokens for planning agents |
| `1111_learn_content_max_tokens` | Max tokens for content generation |

---

## 10. API Client

### 10.1 Anthropic API Integration

The plugin communicates with the Anthropic Messages API via `wp_remote_post()`.

```php
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {stored_api_key}
  anthropic-version: 2023-06-01
  content-type: application/json

Body:
{
  "model": "{configured_model}",
  "max_tokens": {configured_max_tokens},
  "system": "{contents_of_prompt_md_file}",
  "messages": [
    {
      "role": "user",
      "content": "{formatted_input}"
    }
  ]
}
```

**Error handling:**
- 401: Invalid API key — prompt admin to check settings
- 429: Rate limited — show "Rate limited, please wait and retry"
- 5xx: Server error — allow retry
- Timeout: 120-second timeout (Lesson Writer can produce 8000+ tokens) — allow retry
- Parse error: Non-JSON response — retry once automatically

### 10.2 Security

- API key stored encrypted in `wp_options` (`sodium_crypto_secretbox` if available, `AUTH_KEY`-based fallback)
- API key never exposed in client-side JavaScript — all calls server-side via AJAX
- All AJAX endpoints verify nonces and `manage_options` capability
- Prompt files loaded from plugin directory, never from user input

---

## 11. Generation Pipeline (Server-Side)

### 11.1 Pipeline Architecture

The pipeline follows 1111 School's generation service design: each step commits progress to the database, and errors at any step are recoverable without re-running completed steps.

**AJAX Endpoint:** `1111_generate_course`

```
Request → Validate → Create Course Term → Phase 0 → Per-Objective Loop → Complete
```

### 11.2 Phase 0: Course Description

1. Call Course Describer agent with title, description, objectives
2. Validate output (narrative_description + lessons array)
3. Store `_1111_narrative_description` and `_1111_lesson_titles` on the course term
4. Send progress update: lesson titles now visible in the stepper UI

### 11.3 Per-Objective Loop (Phase 1+)

For each objective (index 0 to N-1):

1. **Check for existing content** — if lesson already has content (retry scenario), skip
2. **Lesson Planner** — call with objective, narrative description, all objectives (for scope control), and preset title from Phase 0
3. Validate plan output. Retry once on failure.
4. **Lesson Writer** — call with the full lesson plan and course description
5. Validate content output. Retry once on failure.
6. **Activity Creator** — call with activity seed, objective, and mastery criteria from the plan
7. Validate activity output. Retry once on failure.
8. **Create WordPress post** — `learn` CPT, assigned to course taxonomy, with all meta
9. **Commit and report progress** — save post, update stepper

### 11.4 Post Creation

| Post field | Value |
|------------|-------|
| `post_type` | `learn` |
| `post_title` | `lesson_title` from Lesson Writer |
| `post_content` | `lesson_body` converted from Markdown to WordPress block markup |
| `post_excerpt` | First sentence of `lesson_body`, or `lesson_summary` from Course Describer |
| `post_status` | `draft` (admin reviews before publishing) |
| `menu_order` | Objective index (for ordering) |
| `tax_input` | Assigned to the course taxonomy term |

Posts are created as **drafts** so the admin can review, edit, and publish at their discretion.

### 11.5 Markdown to Block Conversion

The Lesson Writer outputs Markdown (matching School's format). Before saving to WordPress, the orchestrator converts Markdown to WordPress block markup:

- `## Heading` → `<!-- wp:heading {"level":2} --><h2>Heading</h2><!-- /wp:heading -->`
- Paragraphs → `<!-- wp:paragraph --><p>...</p><!-- /wp:paragraph -->`
- Lists → `<!-- wp:list --><ul><li>...</li></ul><!-- /wp:list -->`
- Code blocks → `<!-- wp:code --><pre><code>...</code></pre><!-- /wp:code -->`

This ensures generated content is fully compatible with the Gutenberg block editor.

### 11.6 Incremental Recovery

Following School's incremental recovery pattern:

- Each lesson is committed to the database as it's created
- If the pipeline fails mid-course (e.g., objective 3 of 5 fails):
  - Objectives 1–2 are already saved as draft posts
  - Course term meta shows `generation_status: failed`
  - On retry, the pipeline checks which objectives already have a complete post and skips them
  - Only missing objectives are regenerated

### 11.7 Progress Reporting

Progress is reported via **polling** (WordPress hosting compatible):

- Generation updates a transient (`_1111_generation_progress_{term_id}`) after each step
- Client polls `wp_ajax_1111_generation_status` every 2 seconds
- Progress payload:

```json
{
  "status": "generating",
  "phase": "lesson",
  "current_objective": 1,
  "total_objectives": 3,
  "current_step": "writing",
  "steps_completed": [
    {"objective": 0, "steps": ["planned", "written", "activity_created"]},
    {"objective": 1, "steps": ["planned"]}
  ],
  "lesson_titles": ["Seeing the Barriers", "Auditing with Browser Tools", "Writing Fix Recommendations"],
  "error": null
}
```

---

## 12. Prompt Files

### 12.1 Why Markdown Files?

- **Editable by non-developers:** Subject-matter experts can tweak prompts without touching PHP
- **Version controlled:** Changes are tracked in git
- **Testable independently:** Copy a prompt into the Anthropic Console to test outside WordPress
- **Hot-reloadable:** Changes take effect on the next generation — no cache to clear

### 12.2 Prompt Files

| File | Agent | Model | Purpose |
|------|-------|-------|---------|
| `prompts/course-describer.md` | Course Describer | fast | Narrative arc + lesson titles/summaries |
| `prompts/lesson-planner.md` | Lesson Planner | fast | Backward design lesson plan |
| `prompts/lesson-writer.md` | Lesson Writer | default | Full lesson content from plan |
| `prompts/activity-creator.md` | Activity Creator | fast | Practice activity from activity seed |

### 12.3 Prompt File Structure

Each prompt file contains the full system prompt. The structure mirrors 1111 School's inline prompts but in an editable file:

```markdown
You are an expert [role description].

## Requirements
- requirement 1
- requirement 2

## Rules
- IMPORTANT — [constraint name]: [constraint description]

## Output Format
Respond with ONLY valid JSON, no markdown fencing:
{
  "field": "description"
}
```

---

## 13. Accessibility Requirements

All admin UI must meet WCAG 2.1 AA:

1. **Form inputs:** Every input has a visible `<label>` with `for` attribute matching the input `id`.
2. **Error messages:** Inline errors associated with inputs via `aria-describedby`. Error summary uses `role="alert"`.
3. **Progress updates:** Stepper progress conveyed via `aria-live="polite"` region. Each step completion is announced.
4. **Focus management:** After form submission, focus moves to the progress stepper. After error, focus moves to the first invalid field. After completion, focus moves to the success message.
5. **Keyboard navigation:** All interactive elements reachable and operable via keyboard. Objective repeater supports keyboard add/remove.
6. **Color independence:** Stepper uses icons + text (checkmark + "Complete", spinner + "Writing..."), never color alone.
7. **Screen reader announcements:** Dynamic content changes (step completions, errors, success) announced.
8. **Sufficient contrast:** All text meets 4.5:1 contrast ratio.
9. **Responsive layout:** Dashboard usable at min-width 782px (WordPress admin breakpoint).

---

## 14. Security Requirements

1. **Capability checks:** All admin pages and AJAX handlers require `manage_options` capability.
2. **Nonce verification:** All form submissions and AJAX requests nonce-protected.
3. **Input sanitization:** `sanitize_text_field()`, `sanitize_textarea_field()`, `wp_kses_post()` as appropriate.
4. **Output escaping:** `esc_html()`, `esc_attr()`, `esc_url()`, `wp_kses_post()` as appropriate.
5. **API key storage:** Encrypted at rest, never in client-side code or debug logs.
6. **No direct file access:** All PHP files check `defined('ABSPATH')`.
7. **Content sanitization:** Generated content run through `wp_kses_post()` before saving.

---

## 15. Non-Goals (Explicitly Out of Scope)

These are intentionally excluded from 1111 Learn Creator:

1. **Assessments / activity grading** — No quizzes, scoring, or AI-powered review of learner submissions. Activities are generated as reference content for the admin; grading belongs to 1111 Learn Administrator.
2. **Learner profiles** — No tracking of individual learner progress, preferences, or personalization.
3. **Progress tracking** — No completion tracking or status indicators for learners.
4. **Frontend interactivity** — No JS-driven learner interactions. The plugin produces standard WordPress posts.
5. **User roles / enrollment** — No custom roles, enrollment, or access restrictions.
6. **Certificates or badges** — No completion rewards.
7. **LMS integration** — No direct integration with LearnDash, LifterLMS, etc. (but generated posts are compatible).
8. **Multi-site support** — Single-site only for v1.
9. **Internationalization** — English only for v1 (all strings use `__()` / `_e()` for future translation readiness).
10. **Telemetry** — No usage tracking or data collection.
11. **On-demand generation** — Unlike School, all lessons are generated upfront (no need for on-demand since there's no learner progression to gate on).

---

## 16. Future: 1111 Learn Administrator (Companion Plugin)

A planned companion plugin will add:

- Learner-facing course navigation and progress tracking
- AI-powered activity grading (using the `scoring_rubric` and `mastery_criteria` already generated by this plugin)
- Learner profiles with adaptive content
- Enrollment and access control
- Analytics dashboard
- Integration with the `learn` CPT, `course` taxonomy, and lesson meta created by this plugin

The Learn Creator plugin is designed so the Administrator plugin can build on top of its data structures without modifications. Specifically, `_1111_mastery_criteria`, `_1111_activity`, and `_1111_key_takeaways` are stored as structured meta precisely so the Administrator plugin can use them for grading and progression.

---

## 17. Development Guidelines

1. **No build step.** Vanilla PHP, JS, CSS. No Webpack, Sass, or npm.
2. **WordPress coding standards.** Follow WordPress PHP and JavaScript coding standards.
3. **Minimum requirements:** WordPress 6.0+, PHP 8.0+.
4. **Prefix everything.** `_1111_learn_` for meta/options, `Learn_Creator_` for classes.
5. **No Composer.** API client uses `wp_remote_post()`.
6. **Hooks and filters** for extensibility:
   - `1111_learn_before_describe` — filter course data before Course Describer
   - `1111_learn_course_described` — action after narrative + titles set
   - `1111_learn_before_plan` — filter objective context before Lesson Planner
   - `1111_learn_lesson_planned` — action after plan generated
   - `1111_learn_before_write` — filter plan before Lesson Writer
   - `1111_learn_lesson_written` — action after content generated
   - `1111_learn_before_activity` — filter activity seed before Activity Creator
   - `1111_learn_activity_created` — action after activity generated
   - `1111_learn_lesson_created` — action after WordPress post created
   - `1111_learn_course_complete` — action after all lessons created
   - `1111_learn_validate_{agent}` — filters for custom validation per agent
7. **Prompts are data, not code.** `prompts/*.md` loaded at runtime. Editable without touching PHP.

---

## 18. Implementation Phases

### Phase 1: Foundation
- [ ] Plugin bootstrap file with proper headers and ABSPATH checks
- [ ] Register `learn` custom post type with REST support
- [ ] Register `course` taxonomy
- [ ] Settings page with encrypted API key storage and model selectors
- [ ] `CLAUDE.md` for the new repo
- [ ] `README.md` with install instructions

### Phase 2: Agents and Orchestrator
- [ ] Anthropic API HTTP client class (`wp_remote_post`, error handling, retries)
- [ ] Prompt file loader (reads `prompts/*.md`)
- [ ] JSON parser (handles markdown fencing, extracts JSON from response)
- [ ] Validation functions for each agent's output schema
- [ ] Orchestrator class wiring the four-agent pipeline
- [ ] Write all four prompt files:
  - [ ] `prompts/course-describer.md`
  - [ ] `prompts/lesson-planner.md`
  - [ ] `prompts/lesson-writer.md`
  - [ ] `prompts/activity-creator.md`

### Phase 3: Admin Dashboard
- [ ] Dashboard page registration and menu setup
- [ ] Course creation form (title, description, objectives repeater)
- [ ] Client-side validation with accessible error handling
- [ ] AJAX handler for course generation
- [ ] Polling endpoint for generation progress
- [ ] Vertical stepper progress UI
- [ ] Success / error / retry states

### Phase 4: Content Generation Pipeline
- [ ] Wire dashboard form → orchestrator → agents
- [ ] Phase 0: Course Describer → create taxonomy term with narrative + titles
- [ ] Per-objective loop: Planner → Writer → Activity Creator → create draft post
- [ ] Markdown-to-block conversion for `post_content`
- [ ] Store all structured meta (mastery criteria, activity, takeaways)
- [ ] Incremental recovery: skip already-generated objectives on retry
- [ ] Progress transients and polling responses

### Phase 5: Polish and Quality
- [ ] Accessibility audit: focus management, ARIA, keyboard, contrast
- [ ] Security audit: nonces, capabilities, sanitization, escaping
- [ ] Uninstall cleanup (`uninstall.php` — remove options, term meta, post meta)
- [ ] Test with real API key across diverse course topics
- [ ] Evaluate: Do lessons teach? Are activities aligned to mastery criteria? Does the narrative thread hold?
- [ ] Iterate prompts until output quality is consistently good

---

## 19. Success Criteria

1. An administrator can generate a complete course (3–8 lessons, one per objective) from title + description + objectives in under 3 minutes.
2. Generated lessons follow a visible narrative arc — they read as chapters in the same course, not disconnected topics.
3. Each lesson's content clearly prepares the learner for the associated activity. Backward design is evident.
4. Activities have specific, checkable rubric criteria — not vague "practice what you learned."
5. All generated content is saved as standard WordPress draft posts — viewable in any theme, editable in the block editor.
6. The plugin installs with zero configuration beyond entering an API key.
7. All admin UI passes WCAG 2.1 AA.
8. Agent prompts can be modified in Markdown files and changes take effect immediately.
9. A failed generation can be retried without losing already-generated lessons.
