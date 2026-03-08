import {
  getPreferences, savePreferences,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getWorkProducts, saveWorkProduct,
  saveScreenshot, getScreenshot,
  exportAllData,
  getApiKey, saveApiKey,
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary,
  getDevMode, saveDevMode, appendDevLog
} from './storage.js';
import { loadCourses, checkPrerequisite } from './courses.js';
import * as orchestrator from './orchestrator.js';
import { ApiError } from './api.js';
import { trackEvent, flushNow } from './telemetry.js';

const $ = (sel) => document.querySelector(sel);
const $main = () => $('#main-content');

async function logDev(type, data) {
  try {
    if (await getDevMode()) {
      await appendDevLog({ type, ...data });
      trackEvent(type, data);
    }
  } catch { /* non-blocking */ }
}

let state = {
  view: 'courses',        // courses | course | work | work-detail | settings
  courses: [],
  activeCourseId: null,
  progress: null,
  allProgress: {},
  preferences: null,
  activeWorkCourseId: null,  // for work-detail view
  generating: null           // { courseId, promise } — in-flight generation tracker
};

// Activity type → user-facing label
const TYPE_LABELS = {
  explore: 'Research',
  apply: 'Practice',
  create: 'Draft',
  final: 'Deliver'
};
const TYPE_LETTERS = { explore: 'R', apply: 'P', create: 'D', final: 'F' };

// -- Bootstrap ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await seedFromEnv();
  state.preferences = await getPreferences();
  state.courses = await loadCourses();
  state.allProgress = await getAllProgress();
  bindNav();
  render();
  if (await getDevMode()) {
    trackEvent('session_start', {
      extensionVersion: chrome.runtime.getManifest().version,
      platform: navigator.platform,
    });
  }
});

async function seedFromEnv() {
  try {
    const { ENV } = await import('../.env.js');
    if (ENV.apiKey && !(await getApiKey())) {
      await saveApiKey(ENV.apiKey);
    }
    const prefs = await getPreferences();
    if (ENV.name && !prefs.name) {
      await savePreferences({ ...prefs, name: ENV.name });
    }
  } catch { /* .env.js not present — expected in production */ }
}

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
      (btn.dataset.nav === 'courses' && state.view === 'course') ||
      (btn.dataset.nav === 'work' && state.view === 'work-detail');
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  switch (state.view) {
    case 'courses': return renderCourses();
    case 'course':  return renderCourse();
    case 'work':    return renderWork();
    case 'work-detail': return renderWorkDetail();
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
          <span class="course-status" aria-hidden="true">${state.generating?.courseId === c.courseId ? '<span class="status-spinner"></span>' : statusIcon(status)}</span>
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
  if (state.generating?.courseId === course.courseId) return 'Generating…';
  const prog = state.allProgress[course.courseId];
  if (!prog) return 'Not started';
  const workName = prog.learningPlan?.finalWorkProductDescription;
  if (prog.status === 'completed') {
    return workName ? `Built: ${workName}` : 'Completed';
  }
  const total = prog.learningPlan?.activities?.length || '?';
  const step = prog.currentActivityIndex + 1;
  return workName
    ? `Building ${workName} — step ${step} of ${total}`
    : `Activity ${step} of ${total}`;
}

// -- Active course ------------------------------------------------------------

async function startOrResumeCourse(courseId) {
  const course = state.courses.find((c) => c.courseId === courseId);
  let progress = await getCourseProgress(courseId);

  if (!progress) {
    // If already generating this course, just navigate to it
    if (state.generating?.courseId === courseId) {
      state.activeCourseId = courseId;
      state.view = 'course';
      render();
      return;
    }

    // Check API key
    const ready = await orchestrator.isReady();
    if (!ready) {
      showError('No API key set. Go to Settings to add your Claude API key.');
      return;
    }

    state.activeCourseId = courseId;
    state.view = 'course';

    const promise = (async () => {
      const main = $main();
      const totalSteps = 3;

      function showStep(step, label) {
        // Only update DOM if we're still viewing this course
        if (state.view === 'course' && state.activeCourseId === courseId) {
          main.innerHTML = `
            <div class="loading-container" role="status" aria-live="polite">
              <div class="loading-spinner" aria-hidden="true"></div>
              <p>Setting up your course...</p>
              <p class="loading-substep" aria-label="Step ${step} of ${totalSteps}: ${label}">Step ${step} of ${totalSteps}: ${label}</p>
            </div>`;
        }
      }

      showStep(1, 'Analyzing your profile');

      const profileSummary = await getLearnerProfileSummary();
      const completedNames = Object.entries(state.allProgress)
        .filter(([, p]) => p.status === 'completed')
        .map(([id]) => state.courses.find(c => c.courseId === id)?.name)
        .filter(Boolean);

      showStep(2, 'Building your learning plan');

      const plan = await orchestrator.createLearningPlan(
        course, state.preferences, profileSummary, completedNames
      );

      const newProgress = {
        courseId,
        status: 'in_progress',
        currentActivityIndex: 0,
        learningPlan: {
          activities: plan.activities,
          finalWorkProductDescription: plan.finalWorkProductDescription,
          workProductTool: plan.workProductTool
        },
        activities: [],
        drafts: [],
        startedAt: Date.now(),
        completedAt: null,
        finalWorkProductUrl: null
      };

      showStep(3, 'Preparing your first activity');

      const firstSlot = plan.activities[0];
      const generated = await orchestrator.generateNextActivity(
        course, firstSlot, [], profileSummary, plan
      );
      newProgress.activities.push({
        ...firstSlot,
        instruction: generated.instruction,
        tips: generated.tips
      });

      await saveCourseProgress(courseId, newProgress);
      state.allProgress[courseId] = newProgress;
      trackEvent('course_started', { courseId, totalActivities: plan.activities.length });
      return newProgress;
    })();

    state.generating = { courseId, promise };
    render();

    try {
      progress = await promise;
    } catch (e) {
      state.generating = null;
      handleApiError(e);
      return;
    }

    state.generating = null;
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

  // Course is still being set up (no progress yet)
  if (!p || !p.learningPlan) {
    main.innerHTML = `
      <div class="loading-container" role="status" aria-live="polite">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Setting up your course...</p>
      </div>`;
    return;
  }

  const planActivities = p.learningPlan.activities;
  const currentSlot = planActivities[p.currentActivityIndex];

  // If current activity hasn't been generated yet, generate it (or wait for in-flight generation)
  if (!p.activities[p.currentActivityIndex]) {
    main.innerHTML = `
      <div class="loading-container" role="status" aria-live="polite">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Preparing your next activity...</p>
      </div>`;

    // If already generating for this course, wait for it
    if (state.generating?.courseId === p.courseId) {
      try {
        await state.generating.promise;
      } catch (e) {
        handleApiError(e);
        return;
      }
      // Re-fetch progress after generation completes
      state.progress = state.allProgress[p.courseId];
      render();
      return;
    }

    const promise = (async () => {
      const profileSummary = await getLearnerProfileSummary();
      const progressSummary = p.activities
        .slice(0, p.currentActivityIndex)
        .map((a) => {
          const drafts = p.drafts.filter(d => d.activityId === a.id);
          const last = drafts[drafts.length - 1];
          return { type: a.type, score: last?.score, keyFeedback: last?.feedback?.slice(0, 100) };
        });

      const generated = await orchestrator.generateNextActivity(
        course, currentSlot, progressSummary, profileSummary, p.learningPlan
      );

      p.activities[p.currentActivityIndex] = {
        ...currentSlot,
        instruction: generated.instruction,
        tips: generated.tips
      };

      await saveCourseProgress(p.courseId, p);
    })();

    state.generating = { courseId: p.courseId, promise };

    try {
      await promise;
    } catch (e) {
      state.generating = null;
      handleApiError(e);
      return;
    }

    state.generating = null;
    render();
    return;
  }

  const activity = p.activities[p.currentActivityIndex];
  const draftsForActivity = p.drafts.filter((d) => d.activityId === activity.id);
  const hasDrafts = draftsForActivity.length > 0;
  const lastDraft = hasDrafts ? draftsForActivity[draftsForActivity.length - 1] : null;

  const typeLabel = TYPE_LABELS[activity.type] || activity.type;

  let html = `
    <div class="course-header">
      <button class="back-btn" aria-label="Back to courses" id="back-btn">&larr;</button>
      <div class="course-header-info">
        <h2>${esc(course.name)}</h2>
        <span class="progress-label">${esc(typeLabel)} ${p.currentActivityIndex + 1}/${planActivities.length}</span>
      </div>
      <button class="reset-btn" id="reset-course-btn" aria-label="Reset course" title="Reset course">&#8635;</button>
    </div>
    <div class="chat" role="log" aria-label="Activity conversation">`;

  // Feedback acknowledgment (shown after activity regeneration)
  if (activity.changeNote) {
    html += `<div class="msg msg-change-note" role="status"><p class="change-note-label">Updated based on your feedback</p><p>${esc(activity.changeNote)}</p></div>`;
  }

  // Current activity instruction
  html += instructionMessage(activity.instruction);

  for (const draft of draftsForActivity) {
    html += draftMessage(draft);
    html += feedbackCard(draft);
  }

  // Course completion summary
  if (p.status === 'completed') {
    html += completionSummary(course, p);
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

  // Prior activities (below action bar)
  if (p.currentActivityIndex > 0) {
    const priorItems = [];
    for (let i = p.currentActivityIndex - 1; i >= 0; i--) {
      const prev = p.activities[i];
      if (!prev) continue;
      const prevDrafts = p.drafts.filter((d) => d.activityId === prev.id);
      const prevLabel = TYPE_LABELS[prev.type] || prev.type;
      const lastPrev = prevDrafts[prevDrafts.length - 1];
      const scorePercent = lastPrev ? Math.round((lastPrev.score || 0) * 100) : null;
      priorItems.push(`<div class="prior-step">
        <span class="prior-type">${esc(prevLabel)}</span>
        <span class="prior-goal">${esc(prev.goal || '')}</span>
        ${scorePercent !== null ? `<span class="prior-score">${scorePercent}%</span>` : ''}
      </div>`);
    }
    html += `<details class="prior-activities"><summary>Previous steps (${p.currentActivityIndex})</summary>${priorItems.join('')}</details>`;
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

  const portfolioBtn = $('#view-portfolio-btn');
  if (portfolioBtn) {
    portfolioBtn.addEventListener('click', () => {
      state.activeWorkCourseId = p.courseId;
      navigate('work-detail');
    });
  }

  main.querySelectorAll('.dispute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const draftId = btn.dataset.draftId;
      const draft = p.drafts.find(d => d.id === draftId);
      if (draft) showDisputeForm(course, p, activity, draft);
    });
  });
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
      activity.instruction, activity.tips, feedbackText, p.learningPlan
    );

    p.activities[p.currentActivityIndex] = {
      ...currentSlot,
      instruction: generated.instruction,
      tips: generated.tips,
      changeNote: generated.changeNote || null,
    };

    await saveCourseProgress(p.courseId, p);
    trackEvent('activity_regenerated', {
      courseId: course.courseId,
      activityIndex: p.currentActivityIndex,
      activityType: currentSlot.type,
      activityGoal: currentSlot.goal,
      originalInstruction: activity.instruction,
      learnerFeedback: feedbackText,
      newInstruction: generated.instruction,
      changeNote: generated.changeNote || null,
    });
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

function showDisputeForm(course, p, activity, draft) {
  const main = $main();
  main.innerHTML = `
    <div class="confirm-container" role="dialog" aria-label="Dispute assessment">
      <h2>Dispute Assessment</h2>
      <p>Explain why you think this assessment is wrong. The AI will re-evaluate the same screenshot with your feedback.</p>
      <label for="dispute-input" class="sr-only">Your feedback</label>
      <textarea id="dispute-input" rows="3" class="feedback-textarea" placeholder="e.g. I did complete the task — the result is in the bottom right corner (⌘/Ctrl+Enter to submit)"></textarea>
      <div class="action-bar">
        <button id="cancel-dispute-btn" class="secondary-btn">Cancel</button>
        <button id="submit-dispute-btn" class="primary-btn">Reassess</button>
      </div>
    </div>`;

  const input = $('#dispute-input');
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitDispute(course, p, activity, draft);
    }
    if (e.key === 'Escape') render();
  });
  $('#cancel-dispute-btn').addEventListener('click', () => render());
  $('#submit-dispute-btn').addEventListener('click', () => submitDispute(course, p, activity, draft));
}

async function submitDispute(course, p, activity, draft) {
  const feedbackText = $('#dispute-input')?.value?.trim();
  if (!feedbackText) return;

  const main = $main();
  main.innerHTML = `
    <div class="loading-container" role="status" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>Reassessing your work...</p>
    </div>`;

  try {
    // Load the original screenshot from IndexedDB
    const screenshotDataUrl = await getScreenshot(draft.screenshotKey);
    const profileSummary = await getLearnerProfileSummary();
    const priorDrafts = p.drafts.filter(d => d.activityId === activity.id && d.id !== draft.id);

    const previousAssessment = {
      feedback: draft.feedback,
      strengths: draft.strengths,
      improvements: draft.improvements,
      score: draft.score,
      recommendation: draft.recommendation,
      passed: draft.passed || false
    };

    const originalScore = draft.score;
    const result = await orchestrator.reassessDraft(
      course, activity, screenshotDataUrl, draft.url,
      priorDrafts, profileSummary, previousAssessment, feedbackText
    );

    // Update the draft in place
    draft.feedback = result.feedback;
    draft.strengths = result.strengths;
    draft.improvements = result.improvements;
    draft.score = result.score;
    draft.recommendation = result.recommendation;
    draft.disputed = true;

    trackEvent('dispute', {
      courseId: course.courseId,
      activityType: activity.type,
      activityGoal: activity.goal,
      activityInstruction: activity.instruction,
      originalAssessment: previousAssessment,
      learnerFeedback: feedbackText,
      revisedAssessment: {
        feedback: result.feedback,
        strengths: result.strengths,
        improvements: result.improvements,
        score: result.score,
        recommendation: result.recommendation,
      },
      originalScore,
      revisedScore: result.score,
      scoreChanged: originalScore !== result.score,
    });

    // Handle completion changes
    if (activity.type === 'final' && result.passed && p.status !== 'completed') {
      p.status = 'completed';
      p.completedAt = Date.now();
      p.finalWorkProductUrl = draft.url;
      await saveWorkProduct({
        courseId: p.courseId,
        courseName: course.name,
        url: draft.url,
        completedAt: p.completedAt
      });
    }

    await saveCourseProgress(p.courseId, p);
    state.allProgress[p.courseId] = p;
    render();

    // Update learner profile in background
    updateProfileFromFeedbackInBackground(feedbackText, course, activity);
  } catch (e) {
    handleApiError(e);
  }
}

async function recordDraft(activity) {
  const main = $main();

  // Capture screenshot + URL from active tab (via background service worker)
  let dataUrl = null;
  let pageUrl = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    pageUrl = tab ? tab.url : '';
    const resp = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
    if (resp?.error) throw new Error(resp.error);
    dataUrl = resp?.dataUrl || null;
  } catch (e) {
    console.warn('Screenshot capture failed:', e);
  }

  if (!dataUrl) {
    showError('Could not capture a screenshot. Make sure a webpage is open in the active tab and try again.');
    return;
  }

  // Save screenshot to IndexedDB
  const screenshotKey = `draft-${Date.now()}`;
  await saveScreenshot(screenshotKey, dataUrl);

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

    const attemptNumber = priorDrafts.length + 1;
    trackEvent('draft_submitted', {
      courseId: p.courseId,
      activityIndex: p.currentActivityIndex,
      activityType: activity.type,
      activityGoal: activity.goal,
      activityInstruction: activity.instruction,
      attemptNumber,
      score: result.score,
      recommendation: result.recommendation,
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements,
    });

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
      trackEvent('course_completed', {
        courseId: p.courseId,
        totalActivities: p.learningPlan.activities.length,
        daysElapsed: Math.max(1, Math.ceil((p.completedAt - p.startedAt) / 86400000)),
      });
    }

    if (result.recommendation === 'advance') {
      trackEvent('activity_completed', {
        courseId: p.courseId, activityType: activity.type,
        score: result.score, recommendation: result.recommendation,
        draftCount: attemptNumber,
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
    trackEvent('profile_updated', {
      trigger: 'assessment', strengthsCount: result.profile?.strengths?.length || 0,
      weaknessesCount: result.profile?.weaknesses?.length || 0,
    });
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
    trackEvent('profile_updated', {
      trigger: 'feedback', strengthsCount: result.profile?.strengths?.length || 0,
      weaknessesCount: result.profile?.weaknesses?.length || 0,
    });
  } catch (e) {
    console.warn('Learner profile feedback update failed (non-blocking):', e);
  }
}

// -- Work ---------------------------------------------------------------------

async function renderWork() {
  const main = $main();
  const cards = [];

  // Gather all courses that have progress (in-progress and completed)
  for (const [courseId, p] of Object.entries(state.allProgress)) {
    if (!p.learningPlan) continue;
    const course = state.courses.find(c => c.courseId === courseId);
    if (!course) continue;
    const workName = p.learningPlan.finalWorkProductDescription || course.name;
    const total = p.learningPlan.activities?.length || 0;
    const completed = Math.min(p.currentActivityIndex + (p.status === 'completed' ? 0 : 0), total);
    // Count completed steps: for completed courses all are done; otherwise it's currentActivityIndex
    const completedSteps = p.status === 'completed' ? total : p.currentActivityIndex;
    const recordingCount = p.drafts?.length || 0;

    // Build segmented progress bar
    const segments = (p.learningPlan.activities || []).map((a, i) => {
      const filled = i < completedSteps;
      const current = i === completedSteps && p.status !== 'completed';
      const cls = filled ? 'seg-filled' : current ? 'seg-current' : 'seg-empty';
      return `<span class="progress-seg ${cls}" title="${TYPE_LABELS[a.type] || a.type}"></span>`;
    }).join('');

    const isCompleted = p.status === 'completed';
    const finalUrl = p.finalWorkProductUrl;

    cards.push(`
      <li>
        <button class="work-card" data-work-course="${esc(courseId)}">
          <strong class="work-card-title">${esc(workName)}</strong>
          <small class="work-card-course">${esc(course.name)}</small>
          <div class="progress-bar-segmented">${segments}</div>
          <div class="work-card-stats">
            <span>${recordingCount} recording${recordingCount !== 1 ? 's' : ''}</span>
            ${isCompleted && finalUrl ? `<a href="${esc(finalUrl)}" target="_blank" rel="noopener" class="work-open-link" onclick="event.stopPropagation()">Open</a>` : ''}
          </div>
        </button>
      </li>`);
  }

  if (cards.length === 0) {
    main.innerHTML = '<h2>Portfolio</h2><p>No work products yet. Start a course to begin.</p>';
    return;
  }

  main.innerHTML = `
    <h2>Portfolio</h2>
    <ul class="work-list" role="list">${cards.join('')}</ul>`;

  main.querySelectorAll('[data-work-course]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeWorkCourseId = btn.dataset.workCourse;
      navigate('work-detail');
    });
  });
}

async function renderWorkDetail() {
  const main = $main();
  const courseId = state.activeWorkCourseId;
  const p = state.allProgress[courseId];
  if (!p || !p.learningPlan) { navigate('work'); return; }
  const course = state.courses.find(c => c.courseId === courseId);
  const workName = p.learningPlan.finalWorkProductDescription || course?.name || 'Work Product';
  const planActivities = p.learningPlan.activities || [];
  const total = planActivities.length;
  const completedSteps = p.status === 'completed' ? total : p.currentActivityIndex;

  // Segmented progress bar with type letters
  const segments = planActivities.map((a, i) => {
    const filled = i < completedSteps;
    const current = i === completedSteps && p.status !== 'completed';
    const cls = filled ? 'seg-filled' : current ? 'seg-current' : 'seg-empty';
    const letter = TYPE_LETTERS[a.type] || '?';
    return `<span class="progress-seg-labeled ${cls}" title="${TYPE_LABELS[a.type] || a.type}">${letter}</span>`;
  }).join('');

  let html = `
    <div class="course-header">
      <button class="back-btn" aria-label="Back to portfolio" id="back-btn">&larr;</button>
      <div class="course-header-info">
        <h2>${esc(workName)}</h2>
        <small class="work-detail-course">${esc(course?.name || '')}</small>
      </div>
    </div>
    <div class="progress-bar-labeled">${segments}</div>
    <div class="build-timeline">`;

  for (let i = 0; i < total; i++) {
    const slot = planActivities[i];
    const activity = p.activities?.[i];
    const typeLabel = TYPE_LABELS[slot.type] || slot.type;
    const isFuture = i > completedSteps;
    const isCurrent = i === completedSteps && p.status !== 'completed';
    const drafts = (p.drafts || []).filter(d => d.activityId === slot.id);

    if (isFuture) {
      html += `<div class="timeline-step timeline-future"><span class="timeline-type">${esc(typeLabel)}</span></div>`;
      continue;
    }

    html += `<div class="timeline-step${isCurrent ? ' timeline-current' : ''}">`;
    html += `<div class="timeline-step-header"><span class="timeline-type">${esc(typeLabel)}</span>`;
    if (slot.goal) html += `<span class="timeline-goal">${esc(slot.goal)}</span>`;
    html += `</div>`;

    if (drafts.length > 0) {
      // Show latest draft
      const latest = drafts[drafts.length - 1];
      const latestScore = Math.round((latest.score || 0) * 100);
      const latestTime = new Date(latest.timestamp).toLocaleString();
      html += `<div class="timeline-draft">
        <span class="timeline-draft-score">${latestScore}%</span>
        <span class="timeline-draft-time">${latestTime}</span>
        ${latest.url ? `<a href="${esc(latest.url)}" target="_blank" rel="noopener" class="timeline-draft-link">View</a>` : ''}
        <button class="timeline-screenshot-btn" data-screenshot-key="${esc(latest.screenshotKey)}" aria-label="Show screenshot">Screenshot</button>
      </div>`;

      // Collapsible earlier attempts
      if (drafts.length > 1) {
        html += `<details class="timeline-history"><summary>${drafts.length - 1} earlier attempt${drafts.length > 2 ? 's' : ''}</summary>`;
        for (let d = 0; d < drafts.length - 1; d++) {
          const dr = drafts[d];
          const sc = Math.round((dr.score || 0) * 100);
          const tm = new Date(dr.timestamp).toLocaleString();
          html += `<div class="timeline-draft timeline-draft-old">
            <span class="timeline-draft-score">${sc}%</span>
            <span class="timeline-draft-time">${tm}</span>
            ${dr.url ? `<a href="${esc(dr.url)}" target="_blank" rel="noopener" class="timeline-draft-link">View</a>` : ''}
            <button class="timeline-screenshot-btn" data-screenshot-key="${esc(dr.screenshotKey)}" aria-label="Show screenshot">Screenshot</button>
          </div>`;
        }
        html += `</details>`;
      }
    }

    html += `</div>`;
  }

  html += `</div>`;
  main.innerHTML = html;

  // Bind events
  $('#back-btn').addEventListener('click', () => navigate('work'));

  // On-demand screenshot loading
  main.querySelectorAll('.timeline-screenshot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.screenshotKey;
      if (!key) return;
      // Toggle: if next sibling is a screenshot, remove it
      if (btn.nextElementSibling?.classList.contains('timeline-screenshot-img')) {
        btn.nextElementSibling.remove();
        return;
      }
      btn.textContent = 'Loading...';
      const dataUrl = await getScreenshot(key);
      btn.textContent = 'Screenshot';
      if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'timeline-screenshot-img';
        img.alt = 'Draft screenshot';
        btn.after(img);
      }
    });
  });
}

// -- Settings -----------------------------------------------------------------

async function renderSettings() {
  const main = $main();
  const prefs = state.preferences;
  const hasKey = await orchestrator.isReady();
  const profileSummary = await getLearnerProfileSummary();
  const devModeOn = await getDevMode();

  main.innerHTML = `
    <h2>Settings</h2>

    <div class="settings-section">
      <h3>API Key</h3>
      <p class="settings-hint">Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to enable AI-powered learning.</p>
      <div class="api-key-row">
        <label for="api-key-input" class="sr-only">API Key</label>
        <input type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off" value="${hasKey ? '••••••••••••••••••••••••••••••••••••••••' : ''}">
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
      <div class="toggle-row">
        <label for="dev-mode-toggle">Share data with 11:11</label>
        <input type="checkbox" id="dev-mode-toggle" role="switch" ${devModeOn ? 'checked' : ''}>
      </div>
      <p class="settings-hint">Logs agent interactions locally and sends anonymous telemetry to help improve the extension. Screenshots and API keys are never sent, but feedback text you write may be included. You can disable this at any time.</p>
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
    if (keyInput.value === '••••••••••••••••••••••••••••••••••••••••') keyInput.value = '';
  });
  keyInput.addEventListener('blur', async () => {
    if (!keyInput.value && await getApiKey()) keyInput.value = '••••••••••••••••••••••••••••••••••••••••';
  });

  const saveKey = async () => {
    const key = keyInput.value.trim();
    if (!key || key === '••••••••••••••••••••••••••••••••••••••••') {
      showKeyFeedback('Please enter an API key.', 'error');
      return;
    }
    await saveApiKey(key);
    keyInput.value = '••••••••••••••••••••••••••••••••••••••••';
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

  // Data sharing toggle with consent notice
  $('#dev-mode-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Show consent notice before enabling
      const main = $main();
      main.innerHTML = `
        <div class="confirm-container" role="alertdialog" aria-label="Data sharing consent">
          <h2>Share Data with 11:11?</h2>
          <p>By enabling this, you consent to 11:11 Philosopher's Group collecting anonymous usage data to improve the extension.</p>
          <p><strong>What is collected:</strong> agent prompts, AI responses, feedback text you write, scores, activity metadata, and error messages.</p>
          <p><strong>What is never collected:</strong> screenshots and your API key.</p>
          <p><strong>How it's stored:</strong> data is tied to a random anonymous ID (not your identity), sent to a secure server, and automatically deleted after 90 days.</p>
          <p><strong>Your rights:</strong> you can withdraw consent at any time by turning this off. Disabling stops all future data collection. To request deletion of previously collected data, contact <a href="mailto:1111@philosophers.group">1111@philosophers.group</a> or <a href="https://github.com/1111philo/learn-extension/issues" target="_blank" rel="noopener">open an issue</a>.</p>
          <p>See our <a href="https://github.com/1111philo/learn-extension/blob/main/PRIVACY.md" target="_blank" rel="noopener">privacy policy</a> for full details.</p>
          <div class="action-bar">
            <button id="cancel-devmode-btn" class="secondary-btn">Cancel</button>
            <button id="confirm-devmode-btn" class="primary-btn">I Agree</button>
          </div>
        </div>`;
      $('#cancel-devmode-btn').focus();
      $('#cancel-devmode-btn').addEventListener('click', () => { renderSettings(); });
      $('#confirm-devmode-btn').addEventListener('click', async () => {
        await saveDevMode(true);
        trackEvent('session_start', {
          extensionVersion: chrome.runtime.getManifest().version,
          platform: navigator.platform,
        });
        announce('Data sharing on');
        renderSettings();
      });
    } else {
      await saveDevMode(false);
      flushNow();
      announce('Data sharing off');
    }
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
  $('#error-back-btn').addEventListener('click', () => render());
}

function handleApiError(e) {
  logDev('error', { type: e instanceof ApiError ? e.type : 'unknown', message: e.message || String(e) });
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
  $('#error-back-btn').addEventListener('click', () => render());
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
  const time = new Date(draft.timestamp).toLocaleString();
  const label = draft.url
    ? `<a href="${esc(draft.url)}" target="_blank" rel="noopener" class="draft-link">Draft recorded</a>`
    : 'Draft recorded';
  return `
    <div class="msg msg-draft">
      <svg class="draft-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>
      <div>
        <p class="draft-label">${label}</p>
        <small>${time}</small>
      </div>
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

  html += `<button class="dispute-btn" data-draft-id="${esc(draft.id)}" aria-label="Dispute this assessment">Dispute</button>`;

  html += '</div>';
  return html;
}

function completionSummary(course, p) {
  const workName = p.learningPlan?.finalWorkProductDescription || course.name;
  const totalSteps = p.learningPlan?.activities?.length || 0;
  const totalRecordings = p.drafts?.length || 0;
  const days = p.startedAt && p.completedAt
    ? Math.max(1, Math.ceil((p.completedAt - p.startedAt) / 86400000))
    : 1;
  return `<div class="msg msg-app completion-card">
    <h3>Build Complete</h3>
    <strong class="completion-title">${esc(workName)}</strong>
    <div class="completion-stats">
      <span>${totalSteps} steps</span>
      <span>${totalRecordings} recording${totalRecordings !== 1 ? 's' : ''}</span>
      <span>${days} day${days !== 1 ? 's' : ''}</span>
    </div>
    ${p.finalWorkProductUrl ? `<a href="${esc(p.finalWorkProductUrl)}" target="_blank" rel="noopener" class="completion-link">Open final work</a>` : ''}
    <button class="secondary-btn completion-portfolio-btn" id="view-portfolio-btn">View in Portfolio</button>
  </div>`;
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/** Convert URLs in already-escaped text into clickable links. */
/** Convert URLs in already-escaped text into clickable links. Handles both https://... and bare domain.tld/path URLs. */
function linkify(escaped) {
  // Runs on HTML-escaped text. Match URLs, stopping at whitespace, quotes, or HTML entities.
  return escaped.replace(
    /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s")\]]*)?/gi,
    match => {
      // Strip trailing HTML entities that got swept in (e.g. "&gt;" at end)
      match = match.replace(/&[a-z]+;$/, '');
      // Skip things that look like file extensions (e.g. "style.css") — require a slash or known domain
      if (!match.includes('/') && !match.startsWith('http') && !/\.(com|org|net|io|dev|co|edu|gov|app|me)\b/i.test(match)) return match;
      const href = match.startsWith('http') ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener">${match}</a>`;
    }
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
