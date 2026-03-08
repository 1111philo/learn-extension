/**
 * Telemetry client — buffers events and sends to learn-service.
 * Only active when dev mode is enabled. Fire-and-forget, never blocks UI.
 */

const SERVICE_URL = 'https://czrqy8ea0a.execute-api.us-east-1.amazonaws.com';
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_THRESHOLD = 20;
const CREDS_KEY = 'serviceCredentials';

let buffer = [];
let flushTimer = null;
let sessionId = `sess_${crypto.randomUUID().slice(0, 12)}`;

async function getDevMode() {
  const result = await chrome.storage.local.get('devMode');
  return result.devMode || false;
}

async function getCredentials() {
  const result = await chrome.storage.local.get(CREDS_KEY);
  return result[CREDS_KEY] || null;
}

async function saveCredentials(creds) {
  await chrome.storage.local.set({ [CREDS_KEY]: creds });
}

async function register() {
  const version = chrome.runtime.getManifest().version;
  const res = await fetch(`${SERVICE_URL}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionVersion: version }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);
  const creds = await res.json();
  await saveCredentials(creds);
  return creds;
}

async function flush() {
  if (buffer.length === 0) return;
  if (!await getDevMode()) { buffer = []; return; }

  const events = buffer.splice(0);
  try {
    let creds = await getCredentials();
    if (!creds) creds = await register();

    const res = await fetch(`${SERVICE_URL}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({ events }),
    });

    // Re-register on 401 (key expired/invalid)
    if (res.status === 401) {
      creds = await register();
      await fetch(`${SERVICE_URL}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({ events }),
      });
    }
  } catch {
    // Silently drop — telemetry must never break the app
  }
}

function startTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

function stopTimer() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
}

/**
 * Track a telemetry event. Fire-and-forget.
 * @param {string} type - Event type (e.g. 'agent_response')
 * @param {object} data - Metadata only, no PII or content
 */
export function trackEvent(type, data = {}) {
  // Sanitize: strip any content fields that might leak PII
  const clean = sanitize(data);
  buffer.push({
    type,
    timestamp: new Date().toISOString(),
    sessionId,
    extensionVersion: chrome.runtime.getManifest().version,
    data: clean,
  });
  startTimer();
  if (buffer.length >= FLUSH_THRESHOLD) flush();
}

/** Strip content values, keep only structural metadata. */
function sanitize(data) {
  const blocked = new Set([
    'feedback', 'response', 'instruction', 'tips', 'content',
    'strengths', 'improvements', 'learnerProfile', 'profileSummary',
    'previousInstruction', 'previousTips', 'learnerFeedback',
    'screenshotDataUrl', 'dataUrl', 'apiKey', 'name',
  ]);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (blocked.has(k)) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Flush remaining events (e.g. on page unload). */
export function flushNow() {
  flush();
}
