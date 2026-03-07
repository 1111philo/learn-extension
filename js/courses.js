/**
 * Course loading and activity generation.
 */

let coursesCache = null;

export async function loadCourses() {
  if (coursesCache) return coursesCache;
  const resp = await fetch(chrome.runtime.getURL('data/courses.json'));
  coursesCache = await resp.json();
  return coursesCache;
}

export function checkPrerequisite(course, allProgress) {
  if (!course.dependsOn) return true;
  const dep = allProgress[course.dependsOn];
  return dep && dep.status === 'completed';
}

/**
 * Generate a sequence of activities from a course definition.
 * Each learning objective produces explore -> apply -> create activities.
 * The last objective's final activity is the work-product submission.
 */
/**
 * Generate a sequence of activities from a course definition.
 * Each learning objective produces explore -> apply -> create activities.
 * The last objective's final activity is the work-product submission.
 *
 * @param {object} course - course definition from courses.json
 * @param {object} preferences - user preferences (experienceLevel, etc.)
 * @param {object[]} priorWork - work products from previously completed courses
 */
export function generateActivities(course, preferences, priorWork = []) {
  const activities = [];
  const objectives = course.learningObjectives;
  const level = preferences.experienceLevel || 'beginner';
  const priorContext = priorWork.length > 0
    ? ` You can build on your prior work from: ${priorWork.map((w) => w.courseName).join(', ')}.`
    : '';

  for (let i = 0; i < objectives.length; i++) {
    const obj = objectives[i];
    const isLast = i === objectives.length - 1;

    activities.push({
      id: `${course.courseId}-${i}-explore`,
      objectiveIndex: i,
      type: 'explore',
      instruction: exploreInstruction(obj, level) + priorContext,
      criteria: [`Found a real example related to: "${obj}"`]
    });

    activities.push({
      id: `${course.courseId}-${i}-apply`,
      objectiveIndex: i,
      type: 'apply',
      instruction: applyInstruction(obj, level) + priorContext,
      criteria: [
        `Applied the skill: "${obj}"`,
        'Work builds on the previous exploration'
      ]
    });

    if (isLast) {
      activities.push({
        id: `${course.courseId}-${i}-final`,
        objectiveIndex: i,
        type: 'final',
        instruction: finalInstruction(obj, course) + priorContext,
        criteria: objectives.map((o) => `Demonstrates: "${o}"`),
        passingThreshold: 0.7
      });
    } else {
      activities.push({
        id: `${course.courseId}-${i}-create`,
        objectiveIndex: i,
        type: 'create',
        instruction: createInstruction(obj, level) + priorContext,
        criteria: [`Produced something that shows: "${obj}"`]
      });
    }
  }
  return activities;
}

function exploreInstruction(objective, level) {
  const depth = level === 'beginner'
    ? 'Take your time and look for clear examples.'
    : 'Look for nuanced or edge-case examples.';
  return `Find a real web page that demonstrates: "${objective}". ${depth} When ready, record your draft.`;
}

function applyInstruction(objective, level) {
  const depth = level === 'beginner'
    ? 'Start with a simple case.'
    : 'Challenge yourself with a complex case.';
  return `Practice: "${objective}". ${depth} Build on what you found in your exploration, then record your draft.`;
}

function createInstruction(objective, level) {
  const depth = level === 'beginner'
    ? 'Focus on getting the basics right.'
    : 'Aim for depth and completeness.';
  return `Create something that shows your ability to: "${objective}". ${depth} Record your draft when ready.`;
}

function finalInstruction(objective, course) {
  return `Produce your final work product for "${course.name}". It should demonstrate all course objectives. This is your assessed submission — record your draft when it is ready for review.`;
}
