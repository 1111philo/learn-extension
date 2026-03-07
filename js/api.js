/**
 * Thin fetch wrapper for the Anthropic Messages API.
 */

export const MODEL_LIGHT = 'claude-haiku-4-5-20251001';
export const MODEL_HEAVY = 'claude-sonnet-4-6';

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = 'ApiError';
    this.type = type;   // 'invalid_key' | 'rate_limit' | 'network' | 'parse' | 'api'
    this.status = status;
  }
}

/**
 * Call the Claude API.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {Array} opts.messages - Anthropic message format [{role, content}]
 * @param {number} [opts.maxTokens=1024]
 * @returns {Promise<{content: string, usage: object}>}
 */
export async function callClaude({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new ApiError('network', 'Request timed out after 30 seconds.');
    }
    throw new ApiError('network', 'Network error. Check your connection.');
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const status = resp.status;
    let body;
    try { body = await resp.json(); } catch { body = {}; }
    const msg = body?.error?.message || `API returned ${status}`;

    if (status === 401) throw new ApiError('invalid_key', 'Invalid API key. Check your key in Settings.');
    if (status === 429) throw new ApiError('rate_limit', 'Rate limited. Try again in a moment.');
    throw new ApiError('api', msg, status);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new ApiError('parse', 'Failed to parse API response.');
  }

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new ApiError('parse', 'No text content in API response.');

  return { content: textBlock.text, usage: data.usage };
}
