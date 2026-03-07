import {
  getPreferences, savePreferences,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getWorkProducts, saveWorkProduct,
  saveScreenshot, getScreenshot,
  exportAllData,
  getApiKey, saveApiKey, clearApiKey,
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary
} from './storage.js';
import { loadCourses, checkPrerequisite } from './courses.js';
import * as orchestrator from './orchestrator.js';
import { ApiError } from './api.js';

const $ = (sel) => document.querySelector(sel);
const $main = () => $('#main-content');

let state = {
  view: 'courses',        // courses | course | work | settings
  courses: [],
  activeCourseId: null,
  progress: null,
  allProgress: {},
  preferences: null
};

// -- Bootstrap ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  state.preferences = await getPreferences();
  state.courses = await loadCourses();
  state.allProgress = await getAllProgress();
  bindNav();
  render();
});

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });
}

function navigate(view, data) {
  state.view = view;
  if (data) Object.assign(state, data);
  render();
  $main().focus();
}

// -- Render router ------------------------------------------------------------

function render() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    const active = btn.dataset.nav === state.view ||
      (btn.dataset.nav === 'courses' && state.view === 'course');
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  switch (state.view) {
    case 'courses': return renderCourses();
    case 'course':  return renderCourse();
    case 'work':    return renderWork();
    case 'settings': return renderSettings();
  }
}

// -- Courses list -------------------------------------------------------------

function renderCourses() {
  const main = $main();
  const cards = state.courses.map((c) => {
    const prereqMet = checkPrerequisite(c, state.allProgress);
    const prog = state.allProgress[c.courseId];
    const status = prog ? prog.status : 'not_started';
    const locked = !prereqMet;

    return `
      <li>
        <button class="course-card${locked ? ' locked' : ''}"
                data-course="${c.courseId}"
                ${locked ? 'disabled aria-disabled="true"' : ''}
                aria-label="${c.name}${locked ? ' (locked -- complete prerequisite first)' : ''}">
          <span class="course-status" aria-label="Status: ${status.replace('_', ' ')}">${statusIcon(status)}</span>
          <div class="course-info">
            <strong>${esc(c.name)}</strong>
            <p>${esc(c.description)}</p>
            <small>${c.estimatedHours} hours${locked ? ' -- requires ' + c.dependsOn : ''}</small>
          </div>
        </button>
      </li>`;
  }).join('');

  main.innerHTML = `
    <h2>Courses</h2>
    <ul class="course-list" role="list">${cards}</ul>`;

  main.querySelectorAll('[data-course]').forEach((btn) => {
    btn.addEventListener('click', () => startOrResumeCourse(btn.dataset.course));
  });
}

function statusIcon(s) {
  if (s === 'completed') return '<span aria-hidden="true">&#10003;</span>';
  if (s === 'in_progress') return '<span aria-hidden="true">&#9654;</span>';
  return '<span aria-hidden="true">&#9675;</span>';
}

// -- Active course ------------------------------------------------------------

async function startOrResumeCourse(courseId) {
  const course = state.courses.find((c) => c.courseId === courseId);
  let progress = await getCourseProgress(courseId);

  if (!progress) {
    // Check API key
    const ready = await orchestrator.isReady();
    if (!ready) {
      showError('No API key set. Go to Settings to add your Claude API key.');
      return;
    }

    // Show loading state
    const main = $main();
    main.innerHTML = `
      <div class="loading-container" role="status" aria-live="polite">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Creating your personalized learning plan...</p>
      </div>`;

    try {
      const profileSummary = await getLearnerProfileSummary();
      const completedNames = Object.entries(state.allProgress)
        .filter(([, p]) => p.status === 'completed')
        .map(([id]) => state.courses.find(c => c.courseId === id)?.name)
        .filter(Boolean);

      const plan = await orchestrator.createLearningPlan(
        course, state.preferences, profileSummary, completedNames
      );

      progress = {
        courseId,
        status: 'in_progress',
        currentActivityIndex: 0,
        learningPlan: {
          activities: plan.activities,
          finalWorkProductDescription: plan.finalWorkProductDescription
        },
        activities: [],   // filled incrementally
        drafts: [],
        startedAt: Date.now(),
        completedAt: null,
        finalWorkProductUrl: null
      };

      // Generate instruction for first activity
      const firstSlot = plan.activities[0];
      const generated = await orchestrator.generateNextActivity(
        course, firstSlot, [], profileSummary
      );
      progress.activities.push({
        ...firstSlot,
        instruction: generated.instruction,
        tips: generated.tips,
        estimatedMinutes: generated.estimatedMinutes
      });

      await saveCourseProgress(courseId, progress);
      state.allProgress[courseId] = progress;
    } catch (e) {
      handleApiError(e);
      return;
    }
  }

  state.activeCourseId = courseId;
  state.progress = progress;
  state.view = 'course';
  render();
}

async function renderCourse() {
  const main = $main();
  const course = state.courses.find((c) => c.courseId === state.activeCourseId);
  const p = state.progress;
  const planActivities = p.learningPlan.activities;
  const currentSlot = planActivities[p.currentActivityIndex];

  // If current activity hasn't been generated yet, generate it
  if (!p.activities[p.currentActivityIndex]) {
    main.innerHTML = `
      <div class="loading-container" role="status" aria-live="polite">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Preparing your next activity...</p>
      </div>`;

    try {
      const profileSummary = await getLearnerProfileSummary();
      const progressSummary = p.activities
        .slice(0, p.currentActivityIndex)
        .map((a, i) => {
          const drafts = p.drafts.filter(d => d.activityId === a.id);
          const last = drafts[drafts.length - 1];
          return { type: a.type, score: last?.score, keyFeedback: last?.feedback?.slice(0, 100) };
        });

      const generated = await orchestrator.generateNextActivity(
        course, currentSlot, progressSummary, profileSummary
      );

      p.activities[p.currentActivityIndex] = {
        ...currentSlot,
        instruction: generated.instruction,
        tips: generated.tips,
        estimatedMinutes: generated.estimatedMinutes
      };

      await saveCourseProgress(p.courseId, p);
    } catch (e) {
      handleApiError(e);
      return;
    }
  }

  const activity = p.activities[p.currentActivityIndex];
  const draftsForActivity = p.drafts.filter((d) => d.activityId === activity.id);
  const hasDrafts = draftsForActivity.length > 0;
  const lastDraft = hasDrafts ? draftsForActivity[draftsForActivity.length - 1] : null;

  let html = `
    <div class="course-header">
      <button class="back-btn" aria-label="Back to courses" id="back-btn">&larr;</button>
      <h2>${esc(course.name)}</h2>
      <span class="progress-label">Activity ${p.currentActivityIndex + 1} of ${planActivities.length}</span>
    </div>
    <div class="chat" role="log" aria-live="polite" aria-label="Activity conversation">`;

  // Prior activities summary
  for (let i = 0; i < p.currentActivityIndex; i++) {
    const prev = p.activities[i];
    if (!prev) continue;
    const prevDrafts = p.drafts.filter((d) => d.activityId === prev.id);
    if (prevDrafts.length > 0) {
      const lastPrev = prevDrafts[prevDrafts.length - 1];
      html += `<div class="msg msg-prior" role="note"><p><strong>${esc(prev.type)}:</strong> ${esc(lastPrev.feedback)}</p></div>`;
    }
  }

  // Bridge message
  if (p.currentActivityIndex > 0 && !hasDrafts) {
    html += appMessage('Building on your previous work, here is your next activity.');
  }

  // Current activity instruction + tips
  html += appMessage(activity.instruction);
  if (activity.tips && activity.tips.length > 0) {
    html += `<div class="msg msg-app tips-card" role="note">
      <p class="tips-label"><strong>Tips</strong></p>
      <ul class="tips-list">${activity.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${activity.estimatedMinutes ? `<p class="tips-time"><small>Estimated time: ~${activity.estimatedMinutes} min</small></p>` : ''}
    </div>`;
  }

  // Show drafts + feedback for this activity
  for (const draft of draftsForActivity) {
    html += draftMessage(draft);
    html += feedbackCard(draft);
  }

  // Course completion
  if (p.status === 'completed') {
    html += appMessage('Course complete! Your final work product has been saved to the Work section.');
  }

  html += '</div>';

  // Action bar
  if (p.status !== 'completed') {
    html += '<div class="action-bar">';

    if (lastDraft && lastDraft.recommendation) {
      const rec = lastDraft.recommendation;
      if (rec === 'advance' && p.currentActivityIndex < planActivities.length - 1) {
        html += '<button id="next-activity-btn" class="primary-btn">Next Activity</button>';
      } else if (rec === 'revise') {
        html += '<button id="record-draft-btn" class="primary-btn">Revise Draft</button>';
      } else if (rec === 'continue') {
        if (p.currentActivityIndex < planActivities.length - 1) {
          html += '<button id="next-activity-btn" class="secondary-btn">Next Activity</button>';
        }
        html += '<button id="record-draft-btn" class="primary-btn">Revise Draft</button>';
      }
    } else {
      html += `<button id="record-draft-btn" class="primary-btn">${hasDrafts ? 'Revise Draft' : 'Record Draft'}</button>`;
    }

    html += '</div>';
  }

  main.innerHTML = html;

  $('#back-btn').addEventListener('click', () => navigate('courses'));

  const recordBtn = $('#record-draft-btn');
  if (recordBtn) {
    recordBtn.addEventListener('click', () => recordDraft(activity));
  }

  const nextBtn = $('#next-activity-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      p.currentActivityIndex++;
      await saveCourseProgress(p.courseId, p);
      render();
    });
  }
}

async function recordDraft(activity) {
  const main = $main();

  // Capture screenshot + URL from active tab
  let dataUrl = null;
  let pageUrl = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    pageUrl = tab ? tab.url : '';
    dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  } catch (e) {
    console.warn('Screenshot capture failed:', e);
  }

  // Save screenshot to IndexedDB
  const screenshotKey = `draft-${Date.now()}`;
  if (dataUrl) {
    await saveScreenshot(screenshotKey, dataUrl);
  }

  // Show loading state for AI assessment
  main.innerHTML = `
    <div class="loading-container" role="status" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>Evaluating your work...</p>
    </div>`;

  try {
    const course = state.courses.find((c) => c.courseId === state.activeCourseId);
    const p = state.progress;
    const profileSummary = await getLearnerProfileSummary();
    const priorDrafts = p.drafts.filter(d => d.activityId === activity.id);

    const result = await orchestrator.assessDraft(
      course, activity, dataUrl, pageUrl, priorDrafts, profileSummary
    );

    const draft = {
      id: `draft-${Date.now()}`,
      activityId: activity.id,
      screenshotKey,
      url: pageUrl,
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements,
      score: result.score,
      recommendation: result.recommendation,
      timestamp: Date.now()
    };

    p.drafts.push(draft);

    // Advance or complete
    if (activity.type === 'final' && result.passed) {
      p.status = 'completed';
      p.completedAt = Date.now();
      p.finalWorkProductUrl = pageUrl;
      await saveWorkProduct({
        courseId: p.courseId,
        courseName: course.name,
        url: pageUrl,
        completedAt: p.completedAt
      });
    }

    await saveCourseProgress(p.courseId, p);
    state.allProgress[p.courseId] = p;
    render();

    // Update learner profile in background (non-blocking)
    updateProfileInBackground(result, course, activity);
  } catch (e) {
    handleApiError(e);
  }
}

async function updateProfileInBackground(assessmentResult, course, activity) {
  try {
    let profile = await getLearnerProfile();
    if (!profile) {
      const prefs = state.preferences;
      profile = {
        name: prefs.name || '',
        experienceLevel: prefs.experienceLevel || 'beginner',
        completedCourses: [],
        activeCourses: [],
        strengths: [],
        weaknesses: [],
        revisionPatterns: '',
        pacing: '',
        preferences: {},
        accessibilityNeeds: [],
        recurringSupport: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    const result = await orchestrator.updateLearnerProfile(profile, assessmentResult, {
      courseName: course.name,
      activityType: activity.type,
      activityGoal: activity.goal
    });

    await saveLearnerProfile(result.profile);
    await saveLearnerProfileSummary(result.summary);
  } catch (e) {
    console.warn('Learner profile update failed (non-blocking):', e);
  }
}

// -- Work ---------------------------------------------------------------------

async function renderWork() {
  const main = $main();
  const products = await getWorkProducts();

  if (products.length === 0) {
    main.innerHTML = '<h2>Work</h2><p>No completed work products yet.</p>';
    return;
  }

  const items = products.map((w) => `
    <li class="work-item">
      <strong>${esc(w.courseName)}</strong>
      <a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.url)}</a>
      <small>Completed ${new Date(w.completedAt).toLocaleDateString()}</small>
    </li>`).join('');

  main.innerHTML = `
    <h2>Work</h2>
    <ul class="work-list" role="list">${items}</ul>`;
}

// -- Settings -----------------------------------------------------------------

async function renderSettings() {
  const main = $main();
  const prefs = state.preferences;
  const hasKey = await orchestrator.isReady();

  main.innerHTML = `
    <h2>Settings</h2>

    <div class="settings-section">
      <h3>API Key</h3>
      <p class="settings-hint">Enter your Anthropic API key to enable AI-powered learning.</p>
      <div class="api-key-status ${hasKey ? 'status-set' : 'status-unset'}">
        ${hasKey ? 'API key is set' : 'No API key set'}
      </div>
      <label>
        API Key
        <input type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off">
      </label>
      <div class="action-bar action-bar-left">
        <button id="save-key-btn" class="primary-btn">Save Key</button>
        <button id="test-key-btn" class="secondary-btn" ${!hasKey ? 'disabled' : ''}>Test Key</button>
        <button id="clear-key-btn" class="secondary-btn" ${!hasKey ? 'disabled' : ''}>Clear Key</button>
      </div>
      <div id="key-feedback" role="status" aria-live="polite"></div>
    </div>

    <hr>

    <form id="prefs-form" class="settings-form" aria-label="Preferences">
      <label>
        Name
        <input type="text" name="name" value="${esc(prefs.name || '')}">
      </label>
      <label>
        Experience level
        <select name="experienceLevel">
          <option value="beginner"${prefs.experienceLevel === 'beginner' ? ' selected' : ''}>Beginner</option>
          <option value="intermediate"${prefs.experienceLevel === 'intermediate' ? ' selected' : ''}>Intermediate</option>
          <option value="advanced"${prefs.experienceLevel === 'advanced' ? ' selected' : ''}>Advanced</option>
        </select>
      </label>
      <button type="submit" class="primary-btn">Save</button>
    </form>
    <hr>
    <button id="export-btn" class="secondary-btn">Export all data as JSON</button>`;

  // API key handlers
  $('#save-key-btn').addEventListener('click', async () => {
    const input = $('#api-key-input');
    const key = input.value.trim();
    if (!key) {
      showKeyFeedback('Please enter an API key.', 'error');
      return;
    }
    await saveApiKey(key);
    input.value = '';
    showKeyFeedback('API key saved.', 'success');
    renderSettings(); // refresh status
  });

  $('#test-key-btn').addEventListener('click', async () => {
    showKeyFeedback('Testing...', 'info');
    try {
      const { callClaude, MODEL_LIGHT } = await import('./api.js');
      const apiKey = await getApiKey();
      await callClaude({
        apiKey,
        model: MODEL_LIGHT,
        systemPrompt: 'Reply with exactly: OK',
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 8
      });
      showKeyFeedback('API key is valid!', 'success');
    } catch (e) {
      showKeyFeedback(e.message || 'Key test failed.', 'error');
    }
  });

  $('#clear-key-btn').addEventListener('click', async () => {
    await clearApiKey();
    showKeyFeedback('API key cleared.', 'info');
    renderSettings();
  });

  // Preferences
  $('#prefs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.preferences = {
      name: fd.get('name'),
      experienceLevel: fd.get('experienceLevel')
    };
    await savePreferences(state.preferences);
    announce('Preferences saved.');
  });

  // Export
  $('#export-btn').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '1111-export.json';
    a.click();
    URL.revokeObjectURL(url);
    announce('Data exported.');
  });
}

function showKeyFeedback(msg, type) {
  const el = $('#key-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `key-feedback key-feedback-${type}`;
}

// -- Error handling -----------------------------------------------------------

function showError(message) {
  const main = $main();
  main.innerHTML = `
    <div class="error-container" role="alert">
      <p class="error-message">${esc(message)}</p>
      <div class="action-bar">
        <button class="secondary-btn" id="error-back-btn">Back</button>
      </div>
    </div>`;
  $('#error-back-btn').addEventListener('click', () => navigate('courses'));
}

function handleApiError(e) {
  if (e instanceof ApiError) {
    if (e.type === 'invalid_key') {
      showError('Invalid API key. Go to Settings to update your key.');
    } else if (e.type === 'rate_limit') {
      showErrorWithRetry('Rate limited. Try again in a moment.');
    } else if (e.type === 'network') {
      showErrorWithRetry('Network error. Check your connection.');
    } else {
      showError(e.message);
    }
  } else {
    showError('An unexpected error occurred. Please try again.');
    console.error(e);
  }
}

function showErrorWithRetry(message) {
  const main = $main();
  main.innerHTML = `
    <div class="error-container" role="alert">
      <p class="error-message">${esc(message)}</p>
      <div class="action-bar">
        <button class="secondary-btn" id="error-back-btn">Back</button>
        <button class="primary-btn" id="error-retry-btn">Retry</button>
      </div>
    </div>`;
  $('#error-back-btn').addEventListener('click', () => navigate('courses'));
  $('#error-retry-btn').addEventListener('click', () => render());
}

// -- Helpers ------------------------------------------------------------------

function appMessage(text) {
  return `<div class="msg msg-app" role="status"><p>${esc(text)}</p></div>`;
}

function draftMessage(draft) {
  return `
    <div class="msg msg-user">
      <p class="draft-label">Draft recorded</p>
      ${draft.url ? `<a href="${esc(draft.url)}" target="_blank" rel="noopener" class="draft-link">${esc(draft.url)}</a>` : ''}
      <small>${new Date(draft.timestamp).toLocaleString()}</small>
    </div>`;
}

function feedbackCard(draft) {
  const scorePercent = Math.round((draft.score || 0) * 100);
  let recLabel = '';
  if (draft.recommendation === 'advance') recLabel = 'Ready to advance';
  else if (draft.recommendation === 'revise') recLabel = 'Revision recommended';
  else if (draft.recommendation === 'continue') recLabel = 'Acceptable -- revision optional';

  let html = `<div class="msg msg-app feedback-card" role="status">
    <p>${esc(draft.feedback)}</p>
    <div class="feedback-score">
      <span class="score-badge">${scorePercent}%</span>
      ${recLabel ? `<span class="rec-label rec-${draft.recommendation}">${esc(recLabel)}</span>` : ''}
    </div>`;

  if (draft.strengths && draft.strengths.length > 0) {
    html += `<details class="feedback-details">
      <summary>Strengths</summary>
      <ul>${draft.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </details>`;
  }

  if (draft.improvements && draft.improvements.length > 0) {
    html += `<details class="feedback-details">
      <summary>Areas for improvement</summary>
      <ul>${draft.improvements.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </details>`;
  }

  html += '</div>';
  return html;
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

function announce(msg) {
  let el = $('#sr-announce');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-announce';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'sr-only';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}
