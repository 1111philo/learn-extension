import {
  getPreferences, savePreferences,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getWorkProducts, saveWorkProduct,
  saveScreenshot, getScreenshot,
  exportAllData
} from './storage.js';
import { loadCourses, checkPrerequisite, generateActivities } from './courses.js';
import { assessDraft } from './assessment.js';

const $ = (sel) => document.querySelector(sel);
const $main = () => $('#main-content');

let state = {
  view: 'courses',        // courses | course | work | settings
  courses: [],
  activeCourseId: null,
  progress: null,          // current course progress
  allProgress: {},
  preferences: null
};

// ── Bootstrap ────────────────────────────────────────────────────────────────

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

// ── Render router ────────────────────────────────────────────────────────────

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

// ── Courses list ─────────────────────────────────────────────────────────────

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
                aria-label="${c.name}${locked ? ' (locked — complete prerequisite first)' : ''}">
          <span class="course-status" aria-label="Status: ${status.replace('_', ' ')}">${statusIcon(status)}</span>
          <div class="course-info">
            <strong>${esc(c.name)}</strong>
            <p>${esc(c.description)}</p>
            <small>${c.estimatedHours} hours${locked ? ' — requires ' + c.dependsOn : ''}</small>
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

// ── Active course (chat) ─────────────────────────────────────────────────────

async function startOrResumeCourse(courseId) {
  const course = state.courses.find((c) => c.courseId === courseId);
  let progress = await getCourseProgress(courseId);

  if (!progress) {
    const priorWork = await getWorkProducts();
    const activities = generateActivities(course, state.preferences, priorWork);
    progress = {
      courseId,
      status: 'in_progress',
      currentActivityIndex: 0,
      activities,
      drafts: [],
      startedAt: Date.now(),
      completedAt: null,
      finalWorkProductUrl: null
    };
    await saveCourseProgress(courseId, progress);
    state.allProgress[courseId] = progress;
  }

  state.activeCourseId = courseId;
  state.progress = progress;
  state.view = 'course';
  render();
}

function renderCourse() {
  const main = $main();
  const course = state.courses.find((c) => c.courseId === state.activeCourseId);
  const p = state.progress;
  const activity = p.activities[p.currentActivityIndex];
  const draftsForActivity = p.drafts.filter((d) => d.activityId === activity.id);
  const hasDrafts = draftsForActivity.length > 0;
  const lastDraft = hasDrafts ? draftsForActivity[draftsForActivity.length - 1] : null;

  let html = `
    <div class="course-header">
      <button class="back-btn" aria-label="Back to courses" id="back-btn">&larr;</button>
      <h2>${esc(course.name)}</h2>
      <span class="progress-label">Activity ${p.currentActivityIndex + 1} of ${p.activities.length}</span>
    </div>
    <div class="chat" role="log" aria-live="polite" aria-label="Activity conversation">`;

  // Show summary of completed prior activities as context
  for (let i = 0; i < p.currentActivityIndex; i++) {
    const prev = p.activities[i];
    const prevDrafts = p.drafts.filter((d) => d.activityId === prev.id);
    if (prevDrafts.length > 0) {
      const lastPrev = prevDrafts[prevDrafts.length - 1];
      html += `<div class="msg msg-prior" role="note"><p><strong>${esc(prev.type)}:</strong> ${esc(lastPrev.feedback)}</p></div>`;
    }
  }

  // Contextual bridge from prior activity feedback
  if (p.currentActivityIndex > 0 && !hasDrafts) {
    const prevActivity = p.activities[p.currentActivityIndex - 1];
    const prevDrafts = p.drafts.filter((d) => d.activityId === prevActivity.id);
    if (prevDrafts.length > 0) {
      html += appMessage('Building on your previous work, here is your next activity.');
    }
  }

  // Show current activity instruction
  html += appMessage(activity.instruction);

  // Show drafts for this activity
  for (const draft of draftsForActivity) {
    html += draftMessage(draft);
    html += appMessage(draft.feedback);
  }

  // If course completed
  if (p.status === 'completed') {
    html += appMessage('Course complete! Your final work product has been saved to the Work section.');
  }

  html += '</div>';

  // Action bar
  if (p.status !== 'completed') {
    const canAdvance = hasDrafts && activity.type !== 'final' &&
      p.currentActivityIndex < p.activities.length - 1;

    html += '<div class="action-bar">';
    if (canAdvance) {
      html += '<button id="next-activity-btn" class="secondary-btn">Next Activity</button>';
    }
    html += `<button id="record-draft-btn" class="primary-btn">${hasDrafts ? 'Revise Draft' : 'Record Draft'}</button>`;
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
    // Permission may not be granted — continue without screenshot
    console.warn('Screenshot capture failed:', e);
  }

  // Save screenshot to IndexedDB
  const screenshotKey = `draft-${Date.now()}`;
  if (dataUrl) {
    await saveScreenshot(screenshotKey, dataUrl);
  }

  // Show criteria assessment UI
  showAssessmentUI(activity, screenshotKey, pageUrl, dataUrl);
}

function showAssessmentUI(activity, screenshotKey, pageUrl, screenshotDataUrl) {
  const main = $main();
  const p = state.progress;
  const draftsForActivity = p.drafts.filter((d) => d.activityId === activity.id);

  let html = `
    <div class="course-header">
      <h2>Assess Your Draft</h2>
    </div>
    <div class="assessment-panel" role="form" aria-label="Draft assessment">`;

  if (screenshotDataUrl) {
    html += `<img src="${screenshotDataUrl}" alt="Screenshot of your current page" class="draft-thumbnail">`;
  }
  if (pageUrl) {
    html += `<p class="draft-url"><strong>Page:</strong> ${esc(pageUrl)}</p>`;
  }

  html += '<fieldset><legend>Did your work meet these criteria?</legend>';
  activity.criteria.forEach((c, i) => {
    html += `
      <label class="criterion">
        <input type="checkbox" name="criterion-${i}" value="1">
        <span>${esc(c)}</span>
      </label>`;
  });
  html += '</fieldset>';

  html += `
      <div class="action-bar">
        <button id="cancel-assess-btn">Cancel</button>
        <button id="submit-assess-btn" class="primary-btn">Submit</button>
      </div>
    </div>`;

  main.innerHTML = html;

  $('#cancel-assess-btn').addEventListener('click', () => render());
  $('#submit-assess-btn').addEventListener('click', async () => {
    const checks = activity.criteria.map((_, i) => {
      const cb = main.querySelector(`[name="criterion-${i}"]`);
      return cb ? cb.checked : false;
    });

    const result = assessDraft(activity, checks, draftsForActivity);

    const draft = {
      id: `draft-${Date.now()}`,
      activityId: activity.id,
      screenshotKey,
      url: pageUrl,
      feedback: result.feedback,
      score: result.score,
      timestamp: Date.now()
    };

    p.drafts.push(draft);

    // Advance or complete
    if (activity.type === 'final') {
      if (result.passed) {
        p.status = 'completed';
        p.completedAt = Date.now();
        p.finalWorkProductUrl = pageUrl;
        await saveWorkProduct({
          courseId: p.courseId,
          courseName: state.courses.find((c) => c.courseId === p.courseId).name,
          url: pageUrl,
          completedAt: p.completedAt
        });
      }
      // If not passed, stay on same activity for revision
    }
    // Non-final activities: stay on current activity so user can revise or choose to advance

    await saveCourseProgress(p.courseId, p);
    state.allProgress[p.courseId] = p;
    render();
  });
}

// ── Work ─────────────────────────────────────────────────────────────────────

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

// ── Settings ─────────────────────────────────────────────────────────────────

function renderSettings() {
  const main = $main();
  const prefs = state.preferences;

  main.innerHTML = `
    <h2>Settings</h2>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
