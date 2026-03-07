/**
 * Course loading and prerequisite checking.
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
