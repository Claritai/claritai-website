'use strict';

// Normalise a user-supplied URL into a fetchable https URL.
function normaliseUrl(input) {
  if (!input || typeof input !== 'string') return null;
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    // basic sanity: must have a dot in the host and not be localhost / an IP
    const host = parsed.hostname;
    if (!host.includes('.')) return null;
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    parsed.hash = '';
    return parsed;
  } catch (_) {
    return null;
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// fetch with a hard timeout (ms). Returns the Response or throws.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

function gradeFor(score) {
  if (score >= 85) return { grade: 'A', label: 'Excellent' };
  if (score >= 70) return { grade: 'B', label: 'Strong' };
  if (score >= 55) return { grade: 'C', label: 'Fair' };
  if (score >= 40) return { grade: 'D', label: 'Needs work' };
  return { grade: 'F', label: 'At risk' };
}

module.exports = { normaliseUrl, isValidEmail, fetchWithTimeout, clamp, gradeFor };
