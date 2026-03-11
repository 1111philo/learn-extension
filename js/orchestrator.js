/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { callClaude, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { getApiKey, getDevMode, appendDevLog } from './storage.js';
import { trackEvent } from './telemetry.js';

async function devLog(type, data) {
  try {
    if (await getDevMode()) {
      await appendDevLog({ type, ...data });
      trackEvent(type, data);
    }
  } catch { /* non-blocking */ }
}

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
  // Try parsing as-is first
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // Strip markdown fencing
  const fenced = trimmed.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  try { return JSON.parse(fenced); } catch { /* continue */ }

  // Extract first JSON object from anywhere in the text
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }

  throw new ApiError('parse', 'Failed to parse agent JSON response.');
}

// -- Output validators --------------------------------------------------------

const UNSAFE_PATTERNS = /\b(kill\s+(yourself|your)|self[- ]?harm|suicide\s+method|how\s+to\s+(hack|steal|attack))\b/i;
const PLATFORM_SHORTCUTS = /\b(F12|Ctrl\s*\+\s*Shift\s*\+\s*I|Cmd\s*\+\s*Option\s*\+\s*I|Ctrl\s*\+\s*Shift\s*\+\s*J|Ctrl\s*\+\s*Shift\s*\+\s*C)\b/i;
const MULTI_SITE = /\b(visit\s+.{3,30}then\s+visit|compare\s+.{3,30}with|open\s+.{3,30}and\s+.{3,30}open|go\s+to\s+.{3,30}then\s+go\s+to|navigate\s+to\s+.{3,30}then\s+navigate)\b/i;
const NON_BROWSER_APP = /\b(open\s+(your\s+)?(text\s+editor|terminal|command\s+(line|prompt)|file\s+(manager|explorer)|finder|notepad|textedit|sublime|atom|vim|emacs|nano)|VS\s*Code|Visual\s+Studio|IntelliJ|PyCharm|Xcode|Android\s+Studio|PowerShell)\b/i;
const DEVTOOLS_PATTERN = /\b(DevTools|dev\s+tools|Inspect\s+Element|Lighthouse|open\s+(the\s+)?console|right[- ]click.{0,20}inspect|Elements?\s+(panel|tab)|Network\s+(panel|tab)|Sources?\s+(panel|tab)|F12)\b/i;
const PRODUCES_WORK = /\b(write|type|create|build|draft|compose|summarize|list|outline|note|annotate|describe|explain|fill\s+(in|out)|enter|paste|edit|modify|change|add|code|implement|design)\b/i;

function validateSafety(text) {
  if (UNSAFE_PATTERNS.test(text)) return 'Response contains unsafe content.';
  return null;
}

function validateActivity(parsed) {
  if (!parsed.instruction || typeof parsed.instruction !== 'string') return 'Missing instruction.';
  if (!Array.isArray(parsed.tips)) return 'Missing tips array.';

  const instr = parsed.instruction;

  // Safety
  const safety = validateSafety(instr + ' ' + parsed.tips.join(' '));
  if (safety) return safety;

  // Must end with "Record"
  const lines = instr.split('\n').filter(l => l.trim());
  const lastLine = lines[lines.length - 1]?.toLowerCase() || '';
  if (!lastLine.includes('record')) return 'Last step must tell the learner to hit Record.';

  // Max 4 content steps + the mandatory Record step = 5 total
  const steps = instr.match(/^\d+\.\s/gm);
  if (steps && steps.length > 5) return 'Too many steps (max 4 plus Record).';

  // No platform-specific shortcuts
  if (PLATFORM_SHORTCUTS.test(instr)) return 'Contains platform-specific keyboard shortcuts.';

  // No multi-site instructions
  if (MULTI_SITE.test(instr)) return 'Activity must focus on a single page.';

  // No non-browser apps
  if (NON_BROWSER_APP.test(instr)) return 'Activity must happen entirely in the browser.';

  // No DevTools (not captured in screenshots)
  if (DEVTOOLS_PATTERN.test(instr)) return 'Activity must not use DevTools — screenshots cannot capture browser panels.';

  // Must require the learner to produce something (not just visit a page)
  // Check the steps before the final "Record" step
  const stepsBeforeRecord = lines.slice(0, -1).join(' ');
  if (!PRODUCES_WORK.test(stepsBeforeRecord)) return 'Activity must require the learner to produce visible work, not just visit a page.';

  return null;
}

function validateAssessment(parsed) {
  if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 1) return 'Score must be 0.0-1.0.';
  if (!['advance', 'revise', 'continue'].includes(parsed.recommendation)) return 'Invalid recommendation.';
  if (!parsed.feedback || typeof parsed.feedback !== 'string') return 'Missing feedback.';
  if (!Array.isArray(parsed.strengths)) return 'Missing strengths array.';
  if (!Array.isArray(parsed.improvements)) return 'Missing improvements array.';

  const allText = parsed.feedback + ' ' + parsed.strengths.join(' ') + ' ' + parsed.improvements.join(' ');
  const safety = validateSafety(allText);
  if (safety) return safety;

  return null;
}

/** Call an agent function with validation. Retries once on validation failure. */
async function callWithValidation(agentFn, validator, agentName) {
  const parsed = await agentFn();
  const error = validator(parsed);
  if (!error) {
    devLog('agent_response', { agent: agentName, response: parsed });
    return parsed;
  }
  console.warn(`Validation failed (retrying): ${error}`);
  devLog('validation_failure', { agent: agentName, error, response: parsed });
  // Retry once
  const retry = await agentFn();
  const retryError = validator(retry);
  devLog('agent_response', { agent: agentName, response: retry, retried: true, retryError });
  if (retryError) {
    console.warn(`Validation failed after retry: ${retryError}`);
    if (retryError.includes('unsafe')) throw new ApiError('safety', retryError);
  }
  return retry;
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
 * Initialize a learner profile from onboarding name + statement.
 */
export async function initializeLearnerProfile(name, statement) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('onboarding-profile');

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: JSON.stringify({ name, statement }) }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  devLog('agent_response', { agent: 'onboarding-profile', response: parsed });
  return parsed;
}

/**
 * Generate a diagnostic activity that tests existing knowledge before a course.
 */
export async function generateDiagnosticActivity(course) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('diagnostic-creation');

  const userContent = JSON.stringify({
    course: { name: course.name, learningObjectives: course.learningObjectives }
  });

  const callAgent = async () => {
    const { content } = await callClaude({
      apiKey,
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  const generated = await callWithValidation(callAgent, validateActivity, 'diagnostic-creation');
  return {
    id: `diagnostic-${course.courseId}`,
    type: 'final',
    goal: course.learningObjectives[course.learningObjectives.length - 1],
    instruction: generated.instruction,
    tips: generated.tips
  };
}

/**
 * Create a learning plan for a course.
 */
export async function createLearningPlan(course, preferences, profileSummary, completedCourseNames, diagnosticResult) {
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
    completedCourses: completedCourseNames,
    diagnosticResult: diagnosticResult || null
  });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 2048
  });

  const parsed = parseJSON(content);
  devLog('agent_response', { agent: 'course-creation', response: parsed });
  return parsed;
}

/**
 * Generate the next activity's instruction.
 */
export async function generateNextActivity(course, planSlot, progressSummary, profileSummary, planContext) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('activity-creation');

  const userContent = JSON.stringify({
    course: { name: course.name, learningObjectives: course.learningObjectives },
    activity: { type: planSlot.type, goal: planSlot.goal },
    workProduct: planContext?.finalWorkProductDescription || '',
    workProductTool: planContext?.workProductTool || '',
    priorActivities: progressSummary,
    learnerProfile: profileSummary || 'No profile yet'
  });

  const callAgent = async () => {
    const { content } = await callClaude({
      apiKey,
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateActivity, 'activity-creation');
}

/**
 * Regenerate an activity based on learner feedback.
 */
export async function regenerateActivity(course, planSlot, progressSummary, profileSummary, previousInstruction, previousTips, learnerFeedback, planContext) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('activity-creation');

  const userContent = JSON.stringify({
    course: { name: course.name, learningObjectives: course.learningObjectives },
    activity: { type: planSlot.type, goal: planSlot.goal },
    workProduct: planContext?.finalWorkProductDescription || '',
    workProductTool: planContext?.workProductTool || '',
    priorActivities: progressSummary,
    learnerProfile: profileSummary || 'No profile yet'
  });

  const messages = [
    { role: 'user', content: userContent },
    { role: 'assistant', content: JSON.stringify({ instruction: previousInstruction, tips: previousTips || [] }) },
    { role: 'user', content: `The learner has feedback about this activity: "${learnerFeedback}"\n\nGenerate a new version of this activity that addresses their feedback. You MUST keep the same learning goal: "${planSlot.goal}". The activity must still align with the course learning objectives.\n\nInclude a brief "changeNote" (1-2 sentences) explaining what you changed and why, so the learner knows their feedback was heard.` }
  ];

  const callAgent = async () => {
    const { content } = await callClaude({
      apiKey,
      model: MODEL_LIGHT,
      systemPrompt,
      messages,
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateActivity, 'activity-regeneration');
}

/**
 * Assess a draft submission with vision.
 */
export async function assessDraft(course, activity, screenshotDataUrl, pageUrl, priorDrafts, profileSummary, promptName = 'activity-assessment') {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt(promptName);

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

  const callAgent = async () => {
    const { content } = await callClaude({
      apiKey,
      model: MODEL_HEAVY,
      systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateAssessment, 'activity-assessment');
}

/**
 * Reassess a draft with learner feedback on the assessment.
 * Re-evaluates the same screenshot, factoring in the learner's dispute.
 */
export async function reassessDraft(course, activity, screenshotDataUrl, pageUrl, priorDrafts, profileSummary, previousAssessment, learnerFeedback, promptName = 'activity-assessment') {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt(promptName);

  const compressedDrafts = priorDrafts.map(d => ({
    score: d.score,
    feedback: d.feedback,
    recommendation: d.recommendation
  }));

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

  const messages = [
    { role: 'user', content: contentParts },
    { role: 'assistant', content: JSON.stringify(previousAssessment) },
    { role: 'user', content: `The learner disputes this assessment: "${learnerFeedback}"\n\nRe-evaluate the same screenshot, taking their feedback into account. You may adjust your score, recommendation, and feedback if their point is valid. Respond with the same JSON format.` }
  ];

  const callAgent = async () => {
    const { content } = await callClaude({
      apiKey,
      model: MODEL_HEAVY,
      systemPrompt,
      messages,
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateAssessment, 'assessment-reassess');
}

/**
 * Update the learner profile after learner feedback on an activity.
 */
export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext) {
  const apiKey = await requireKey();
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    learnerFeedback: feedbackText,
    context: {
      courseName: activityContext.courseName,
      activityType: activityContext.activityType,
      activityGoal: activityContext.activityGoal,
      timestamp: Date.now()
    }
  });

  devLog('agent_request', { agent: 'profile-from-feedback', feedback: feedbackText, context: activityContext });

  const { content } = await callClaude({
    apiKey,
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  devLog('agent_response', { agent: 'profile-from-feedback', response: parsed });
  return parsed;
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

  const parsed = parseJSON(content);
  devLog('agent_response', { agent: 'profile-update', response: parsed });
  return parsed;
}
