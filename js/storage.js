/**
 * Metadata storage via chrome.storage.local.
 * Keys: preferences, progress-{courseId}, work
 */

export async function getPreferences() {
  const result = await chrome.storage.local.get('preferences');
  return result.preferences || { name: '' };
}

export async function savePreferences(prefs) {
  await chrome.storage.local.set({ preferences: prefs });
}

export async function getCourseProgress(courseId) {
  const key = `progress-${courseId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

export async function saveCourseProgress(courseId, progress) {
  const key = `progress-${courseId}`;
  await chrome.storage.local.set({ [key]: progress });
}

export async function getAllProgress() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('progress-')) {
      out[k.replace('progress-', '')] = v;
    }
  }
  return out;
}

export async function getWorkProducts() {
  const result = await chrome.storage.local.get('work');
  return result.work || [];
}

export async function saveWorkProduct(product) {
  const products = await getWorkProducts();
  products.push(product);
  await chrome.storage.local.set({ work: products });
}

// --- API key ---

export async function getApiKey() {
  const result = await chrome.storage.local.get('apiKey');
  return result.apiKey || null;
}

export async function saveApiKey(key) {
  await chrome.storage.local.set({ apiKey: key });
}

// --- Learner profile ---

export async function getLearnerProfile() {
  const result = await chrome.storage.local.get('learnerProfile');
  return result.learnerProfile || null;
}

export async function saveLearnerProfile(profile) {
  await chrome.storage.local.set({ learnerProfile: profile });
}

export async function getLearnerProfileSummary() {
  const result = await chrome.storage.local.get('learnerProfileSummary');
  return result.learnerProfileSummary || '';
}

export async function saveLearnerProfileSummary(summary) {
  await chrome.storage.local.set({ learnerProfileSummary: summary });
}

// --- Developer mode ---

export async function getDevMode() {
  const result = await chrome.storage.local.get('devMode');
  return result.devMode || false;
}

export async function saveDevMode(enabled) {
  await chrome.storage.local.set({ devMode: enabled });
}

export async function getDevLog() {
  const result = await chrome.storage.local.get('devLog');
  return result.devLog || [];
}

export async function appendDevLog(entry) {
  const log = await getDevLog();
  log.push({ ...entry, timestamp: Date.now() });
  // Keep last 500 entries to avoid storage bloat
  if (log.length > 500) log.splice(0, log.length - 500);
  await chrome.storage.local.set({ devLog: log });
}

export async function exportAllData() {
  const metadata = await chrome.storage.local.get(null);
  const blobs = await exportAllBlobs();
  return { metadata, blobs };
}

// --- IndexedDB for binary assets (screenshots) ---

const DB_NAME = '1111-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'screenshots';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScreenshot(key, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getScreenshot(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function exportAllBlobs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    const keyReq = store.getAllKeys();
    const result = {};
    tx.oncomplete = () => {
      for (let i = 0; i < keyReq.result.length; i++) {
        result[keyReq.result[i]] = req.result[i];
      }
      resolve(result);
    };
    tx.onerror = () => reject(tx.error);
  });
}
