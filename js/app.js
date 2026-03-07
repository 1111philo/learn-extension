import {
  getPreferences, savePreferences,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getWorkProducts, saveWorkProduct,
  saveScreenshot, getScreenshot,
  exportAllData,
  getApiKey, saveApiKey,
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
                ${locked ? 'disabled' : ''}>
          <span class="course-status" aria-hidden="true">${statusIcon(status)}</span>
          <div class="course-info">
            <strong>${esc(c.name)}</strong>
            <p>${esc(c.description)}</p>
            <small>${progressLabel(c, locked)}</small>
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

function progressLabel(course, locked) {
  if (locked) return 'Requires ' + course.dependsOn;
  const prog = state.allProgress[course.courseId];
  if (!prog) return 'Not started';
  if (prog.status === 'completed') return 'Completed';
  const total = prog.learningPlan?.activities?.length || '?';
  return `Activity ${prog.currentActivityIndex + 1} of ${total}`;
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

    const main = $main();
    const totalSteps = 3;

    function showStep(step, label) {
      main.innerHTML = `
        <div class="loading-container" role="status" aria-live="polite">
          <div class="loading-spinner" aria-hidden="true"></div>
          <p>Creating your personalized learning plan...</p>
          <p class="loading-substep" aria-label="Step ${step} of ${totalSteps}: ${label}">Step ${step} of ${totalSteps}: ${label}</p>
        </div>`;
    }

    showStep(1, 'Analyzing your profile');

    try {
      const profileSummary = await getLearnerProfileSummary();
      const completedNames = Object.entries(state.allProgress)
        .filter(([, p]) => p.status === 'completed')
        .map(([id]) => state.courses.find(c => c.courseId === id)?.name)
        .filter(Boolean);

      showStep(2, 'Building your learning plan');

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

      showStep(3, 'Preparing your first activity');

      // Generate instruction for first activity
      const firstSlot = plan.activities[0];
      const generated = await orchestrator.generateNextActivity(
        course, firstSlot, [], profileSummary
      );
      progress.activities.push({
        ...firstSlot,
        instruction: generated.instruction,
        tips: generated.tips
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
        tips: generated.tips
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
      <button class="reset-btn" id="reset-course-btn" aria-label="Reset course" title="Reset course">&#8635;</button>
    </div>
    <div class="chat" role="log" aria-label="Activity conversation">`;

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

  // Current activity instruction
  html += instructionMessage(activity.instruction);

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

    if (!hasDrafts) {
      html += '<button id="feedback-btn" class="secondary-btn" aria-label="Give feedback on this activity">Feedback</button>';
    }

    if (lastDraft && lastDraft.recommendation) {
      const rec = lastDraft.recommendation;
      if (rec === 'advance' && p.currentActivityIndex < planActivities.length - 1) {
        html += '<button id="next-activity-btn" class="primary-btn">Next Activity</button>';
      } else if (rec === 'revise') {
        html += '<button id="record-draft-btn" class="record-btn">&#9679; Revise Draft</button>';
      } else if (rec === 'continue') {
        if (p.currentActivityIndex < planActivities.length - 1) {
          html += '<button id="next-activity-btn" class="secondary-btn">Next Activity</button>';
        }
        html += '<button id="record-draft-btn" class="record-btn">&#9679; Revise Draft</button>';
      }
    } else {
      html += `<button id="record-draft-btn" class="record-btn">&#9679; Record</button>`;
    }

    html += '</div>';
  }

  main.innerHTML = html;

  $('#back-btn').addEventListener('click', () => navigate('courses'));
  $('#reset-course-btn').addEventListener('click', () => confirmResetCourse(course, p));

  const feedbackBtn = $('#feedback-btn');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => showActivityFeedback(course, p));
  }

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

function showActivityFeedback(course, p) {
  const main = $main();
  main.innerHTML = `
    <div class="confirm-container" role="dialog" aria-label="Activity feedback">
      <h2>Activity Feedback</h2>
      <p>Describe what's wrong or ask a question. The activity will be regenerated to address your feedback while keeping the same learning goal.</p>
      <label for="feedback-input" class="sr-only">Your feedback</label>
      <textarea id="feedback-input" rows="3" class="feedback-textarea" placeholder="e.g. I'm on a phone and can't use DevTools (⌘/Ctrl+Enter to submit)"></textarea>
      <div class="action-bar">
        <button id="cancel-feedback-btn" class="secondary-btn">Cancel</button>
        <button id="submit-feedback-btn" class="primary-btn">Regenerate</button>
      </div>
    </div>`;

  const feedbackInput = $('#feedback-input');
  feedbackInput.focus();
  feedbackInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      regenerateCurrentActivity(course, p);
    }
    if (e.key === 'Escape') render();
  });
  $('#cancel-feedback-btn').addEventListener('click', () => render());
  $('#submit-feedback-btn').addEventListener('click', () => regenerateCurrentActivity(course, p));
}

async function regenerateCurrentActivity(course, p) {
  const feedbackText = $('#feedback-input')?.value?.trim();
  if (!feedbackText) return;

  const main = $main();
  main.innerHTML = `
    <div class="loading-container" role="status" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>Regenerating activity based on your feedback...</p>
    </div>`;

  try {
    const planActivities = p.learningPlan.activities;
    const currentSlot = planActivities[p.currentActivityIndex];
    const activity = p.activities[p.currentActivityIndex];
    const profileSummary = await getLearnerProfileSummary();
    const progressSummary = p.activities
      .slice(0, p.currentActivityIndex)
      .map(a => {
        const drafts = p.drafts.filter(d => d.activityId === a.id);
        const last = drafts[drafts.length - 1];
        return { type: a.type, score: last?.score, keyFeedback: last?.feedback?.slice(0, 100) };
      });

    const generated = await orchestrator.regenerateActivity(
      course, currentSlot, progressSummary, profileSummary,
      activity.instruction, activity.tips, feedbackText
    );

    p.activities[p.currentActivityIndex] = {
      ...currentSlot,
      instruction: generated.instruction,
      tips: generated.tips
    };

    await saveCourseProgress(p.courseId, p);
    updateProfileFromFeedbackInBackground(feedbackText, course, currentSlot);
    render();
  } catch (e) {
    handleApiError(e);
  }
}

function confirmResetCourse(course, progress) {
  const main = $main();
  main.innerHTML = `
    <div class="confirm-container" role="alertdialog" aria-label="Confirm reset">
      <h2>Reset "${esc(course.name)}"?</h2>
      <p>This will permanently delete all progress, drafts, and feedback for this course. This cannot be undone.</p>
      <div class="action-bar">
        <button id="cancel-reset-btn" class="secondary-btn">Cancel</button>
        <button id="confirm-reset-btn" class="danger-btn">Reset Course</button>
      </div>
    </div>`;

  $('#cancel-reset-btn').focus();
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', handler); render(); }
  });
  $('#cancel-reset-btn').addEventListener('click', () => render());
  $('#confirm-reset-btn').addEventListener('click', async () => {
    await chrome.storage.local.remove(`progress-${progress.courseId}`);
    delete state.allProgress[progress.courseId];
    state.progress = null;
    state.activeCourseId = null;
    state.view = 'courses';
    announce(`${course.name} has been reset.`);
    render();
  });
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

function defaultProfile() {
  return {
    name: state.preferences?.name || '',
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

/** Merge agent-returned profile with existing profile so data is never lost. */
function mergeProfile(existing, returned) {
  const merged = { ...existing };
  // Merge simple string fields — keep returned if non-empty, else keep existing
  for (const key of ['name', 'revisionPatterns', 'pacing']) {
    if (returned[key]) merged[key] = returned[key];
  }
  // Merge array fields — union of existing + returned, deduplicated
  for (const key of ['completedCourses', 'activeCourses', 'strengths', 'weaknesses', 'accessibilityNeeds', 'recurringSupport']) {
    const combined = [...(existing[key] || []), ...(returned[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  // Merge preferences object — returned values override existing keys
  merged.preferences = { ...(existing.preferences || {}), ...(returned.preferences || {}) };
  // Timestamps
  merged.createdAt = existing.createdAt || returned.createdAt;
  merged.updatedAt = returned.updatedAt || Date.now();
  return merged;
}

async function saveProfileResult(existing, result) {
  const merged = mergeProfile(existing, result.profile);
  await saveLearnerProfile(merged);
  await saveLearnerProfileSummary(result.summary);
}

async function updateProfileInBackground(assessmentResult, course, activity) {
  try {
    const profile = await getLearnerProfile() || defaultProfile();
    const result = await orchestrator.updateLearnerProfile(profile, assessmentResult, {
      courseName: course.name,
      activityType: activity.type,
      activityGoal: activity.goal
    });
    await saveProfileResult(profile, result);
  } catch (e) {
    console.warn('Learner profile update failed (non-blocking):', e);
  }
}

async function updateProfileFromFeedbackInBackground(feedbackText, course, activity) {
  try {
    const profile = await getLearnerProfile() || defaultProfile();
    const result = await orchestrator.updateProfileFromFeedback(profile, feedbackText, {
      courseName: course.name,
      activityType: activity.type,
      activityGoal: activity.goal
    });
    await saveProfileResult(profile, result);
  } catch (e) {
    console.warn('Learner profile feedback update failed (non-blocking):', e);
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
  const profileSummary = await getLearnerProfileSummary();

  main.innerHTML = `
    <h2>Settings</h2>

    <div class="settings-section">
      <h3>API Key</h3>
      <p class="settings-hint">Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to enable AI-powered learning.</p>
      <div class="api-key-row">
        <label for="api-key-input" class="sr-only">API Key</label>
        <input type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off" value="${hasKey ? '••••••••' : ''}">
        <button id="save-key-btn" class="primary-btn">Save</button>
      </div>
      <div id="key-feedback" role="status" aria-live="polite"></div>
    </div>

    <hr>

    <div class="settings-section">
      <h3>Personalization</h3>
      <form id="prefs-form" class="settings-form" aria-label="Personalization">
        <label>
          Name
          <input type="text" name="name" value="${esc(prefs.name || '')}">
        </label>
        <label>
          Learner Profile
          <textarea name="learnerProfile" rows="5" placeholder="This is updated automatically by the AI as you learn. You can also edit it yourself.">${esc(profileSummary)}</textarea>
        </label>
        <button type="submit" class="primary-btn">Save</button>
        <div id="prefs-feedback" role="status" aria-live="polite"></div>
      </form>
    </div>

    <hr>
    <div class="settings-section">
      <h3>Data Management</h3>
    </div>
    <div class="settings-actions">
      <button id="export-btn" class="settings-action-btn">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1v9m0 0L5 7m3 3 3-3M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Export data as JSON
      </button>
      <button id="delete-all-btn" class="settings-action-btn settings-action-danger">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4m2 0v9.33a1.33 1.33 0 0 1-1.34 1.34H4.67a1.33 1.33 0 0 1-1.34-1.34V4h9.34Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Delete all data
      </button>
    </div>`;

  // API key
  const keyInput = $('#api-key-input');
  keyInput.addEventListener('focus', () => {
    if (keyInput.value === '••••••••') keyInput.value = '';
  });
  keyInput.addEventListener('blur', async () => {
    if (!keyInput.value && await getApiKey()) keyInput.value = '••••••••';
  });

  const saveKey = async () => {
    const key = keyInput.value.trim();
    if (!key || key === '••••••••') {
      showKeyFeedback('Please enter an API key.', 'error');
      return;
    }
    await saveApiKey(key);
    keyInput.value = '••••••••';
    showKeyFeedback('Saved!', 'success');
  };

  $('#save-key-btn').addEventListener('click', saveKey);
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveKey(); }
  });

  // Personalization — Cmd/Ctrl+Enter submits from textarea
  const prefsForm = $('#prefs-form');
  prefsForm.querySelector('textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      prefsForm.requestSubmit();
    }
  });
  prefsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.preferences = { name: fd.get('name') };
    await savePreferences(state.preferences);
    await saveLearnerProfileSummary(fd.get('learnerProfile'));
    showFormFeedback('prefs-feedback', 'Saved!');
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

  // Delete all data
  $('#delete-all-btn').addEventListener('click', () => {
    const main = $main();
    main.innerHTML = `
      <div class="confirm-container" role="alertdialog" aria-label="Confirm delete all data">
        <h2>Delete all data?</h2>
        <p>This will permanently erase all courses progress, drafts, screenshots, preferences, learner profile, and API key. This cannot be undone.</p>
        <div class="action-bar">
          <button id="cancel-delete-btn" class="secondary-btn">Cancel</button>
          <button id="confirm-delete-btn" class="danger-btn">Delete Everything</button>
        </div>
      </div>`;

    $('#cancel-delete-btn').focus();
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', handler); renderSettings(); }
    });
    $('#cancel-delete-btn').addEventListener('click', () => renderSettings());
    $('#confirm-delete-btn').addEventListener('click', async () => {
      await chrome.storage.local.clear();
      // Clear IndexedDB
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      } catch { /* indexedDB.databases() not supported in all contexts */ }
      state.preferences = { name: '' };
      state.allProgress = {};
      state.progress = null;
      state.activeCourseId = null;
      state.view = 'settings';
      announce('All data deleted.');
      render();
    });
  });
}

function showFormFeedback(id, msg) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = msg;
  el.className = 'form-feedback form-feedback-show';
  setTimeout(() => { el.className = 'form-feedback'; }, 2000);
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
    } else if (e.type === 'safety') {
      showError('Content was flagged as unsafe. Please try a different approach.');
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
  return `<div class="msg msg-app"><p>${esc(text)}</p></div>`;
}

function instructionMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let intro = '';
  const steps = [];

  for (const line of lines) {
    const stepMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (stepMatch) {
      steps.push(stepMatch[2]);
    } else {
      if (steps.length === 0) {
        intro += (intro ? ' ' : '') + line;
      }
    }
  }

  let html = '<div class="msg msg-app instruction-card">';
  if (intro) html += `<p class="instruction-intro">${linkify(esc(intro))}</p>`;
  if (steps.length > 0) {
    html += '<ol class="instruction-steps">';
    for (const step of steps) {
      html += `<li>${linkify(esc(step))}</li>`;
    }
    html += '</ol>';
  }
  if (!intro && steps.length === 0) {
    html += `<p>${linkify(esc(text))}</p>`;
  }
  html += '</div>';
  return html;
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

  let html = `<div class="msg msg-app feedback-card">
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

/** Convert URLs in already-escaped text into clickable links. */
function linkify(escaped) {
  return escaped.replace(
    /https?:\/\/[^\s&lt;&amp;)"\]]+/g,
    url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
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
