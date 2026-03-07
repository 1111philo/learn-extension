/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { callClaude, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { getApiKey } from './storage.js';

// Prompt cache (loaded once per session)
const promptCache = {};

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const url = chrome.runtime.getURL(`prompts/${name}.md`);
  const resp = await fetch(url);
  const text = await resp.text();
  promptCache[name] = text;
  return text;
}

function parseJSON(text) {
  // Strip markdown fencing if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ApiError('parse', 'Failed to parse agent JSON response.');
  }
}

async function requireKey() {
  const key = await getApiKey();
  if (!key) throw new ApiError('invalid_key', 'No API key set. Add your key in Settings.');
  return key;
}

/**
 * Check if the orchestrator is ready (API key is set).
 */
export async function isReady() {
  const key = await getApiKey();
  return !!key;
}

/**
 * Create a learning plan for a course.
 */
export async function createLearningPlan(course, preferences, profileSummary, completedCourseNames) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('course-creation');

  const userContent = JSON.stringify({
    course: {
      courseId: course.courseId,
      name: course.name,
      description: course.description,
      learningObjectives: course.learningObjectives
    },
    learnerProfile: profileSummary || `${preferences.name || 'Learner'}`,
    completedCourses: completedCourseNames
  });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 2048
  });

  return parseJSON(content);
}

/**
 * Generate the next activity's instruction.
 */
export async function generateNextActivity(course, planSlot, progressSummary, profileSummary) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('activity-creation');

  const userContent = JSON.stringify({
    course: { name: course.name, learningObjectives: course.learningObjectives },
    activity: { type: planSlot.type, goal: planSlot.goal },
    priorActivities: progressSummary,
    learnerProfile: profileSummary || 'No profile yet'
  });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  return parseJSON(content);
}

/**
 * Regenerate an activity based on learner feedback.
 */
export async function regenerateActivity(course, planSlot, progressSummary, profileSummary, previousInstruction, learnerFeedback) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('activity-creation');

  const userContent = JSON.stringify({
    course: { name: course.name, learningObjectives: course.learningObjectives },
    activity: { type: planSlot.type, goal: planSlot.goal },
    priorActivities: progressSummary,
    learnerProfile: profileSummary || 'No profile yet'
  });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [
      { role: 'user', content: userContent },
      { role: 'assistant', content: JSON.stringify({ instruction: previousInstruction }) },
      { role: 'user', content: `The learner has feedback about this activity: "${learnerFeedback}"\n\nGenerate a new version of this activity that addresses their feedback. You MUST keep the same learning goal: "${planSlot.goal}". The activity must still align with the course learning objectives.` }
    ],
    maxTokens: 1024
  });

  return parseJSON(content);
}

/**
 * Assess a draft submission with vision.
 */
export async function assessDraft(course, activity, screenshotDataUrl, pageUrl, priorDrafts, profileSummary) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('activity-assessment');

  const compressedDrafts = priorDrafts.map(d => ({
    score: d.score,
    feedback: d.feedback,
    recommendation: d.recommendation
  }));

  // Build message content with image block if screenshot available
  const contentParts = [];

  contentParts.push({
    type: 'text',
    text: JSON.stringify({
      course: { name: course.name, learningObjectives: course.learningObjectives },
      activity: {
        id: activity.id,
        type: activity.type,
        goal: activity.goal,
        instruction: activity.instruction
      },
      pageUrl,
      priorDrafts: compressedDrafts,
      learnerProfile: profileSummary || 'No profile yet'
    })
  });

  if (screenshotDataUrl) {
    // Extract base64 and media type from data URL
    const match = screenshotDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1],
          data: match[2]
        }
      });
    }
  }

  const { content } = await callClaude({
    apiKey,
    model: MODEL_HEAVY,
    systemPrompt,
    messages: [{ role: 'user', content: contentParts }],
    maxTokens: 1024
  });

  return parseJSON(content);
}

/**
 * Update the learner profile after an assessment.
 */
export async function updateLearnerProfile(fullProfile, assessmentResult, activityContext) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    assessment: {
      score: assessmentResult.score,
      feedback: assessmentResult.feedback,
      strengths: assessmentResult.strengths,
      improvements: assessmentResult.improvements,
      recommendation: assessmentResult.recommendation
    },
    context: {
      courseName: activityContext.courseName,
      activityType: activityContext.activityType,
      activityGoal: activityContext.activityGoal,
      timestamp: Date.now()
    }
  });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  return parseJSON(content);
}
