'use strict';

// File storage for uploaded documents.
//
// Files go on a Render persistent disk, not in Postgres — a database is a poor
// place for binaries, and a disk costs 25c/GB/month. The database keeps the
// record (title, who it went to, whether it's signed); the disk keeps the bytes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.FILES_DIR || path.join(__dirname, '..', '.data', 'files');
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — comfortably more than a proposal

// Deliberately conservative: documents and images, nothing executable.
const ALLOWED = {
  pdf:'application/pdf',
  doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt:'application/vnd.oasis.opendocument.text',
  txt:'text/plain', md:'text/markdown', csv:'text/csv', rtf:'application/rtf',
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
  webp:'image/webp', svg:'image/svg+xml', zip:'application/zip'
};

function ready() {
  fs.mkdirSync(DIR, { recursive: true });
}

function extOf(filename) {
  const m = String(filename||'').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : '';
}

function isAllowed(filename) {
  return Object.prototype.hasOwnProperty.call(ALLOWED, extOf(filename));
}

function contentType(filename) {
  return ALLOWED[extOf(filename)] || 'application/octet-stream';
}

// Ids are random, not derived from the name — so knowing a filename tells you
// nothing about where it lives, and two files called proposal.pdf never clash.
function newId(filename) {
  return crypto.randomBytes(16).toString('hex') + (extOf(filename) ? '.' + extOf(filename) : '');
}

function pathFor(id) {
  // Never let a request escape the directory.
  const safe = path.basename(String(id||''));
  if (!safe || safe.indexOf('..') >= 0) return null;
  return path.join(DIR, safe);
}

function exists(id) {
  const p = pathFor(id);
  return !!p && fs.existsSync(p);
}

function remove(id) {
  const p = pathFor(id);
  if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) {} }
}

// Streams the request body straight to disk, refusing anything oversized part
// way through rather than buffering it all in memory first.
function receive(req, filename) {
  return new Promise((resolve, reject) => {
    if (!isAllowed(filename)) {
      const e = new Error('That file type is not accepted'); e.status = 415; return reject(e);
    }
    ready();
    const id = newId(filename);
    const dest = pathFor(id);
    const out = fs.createWriteStream(dest);
    let bytes = 0, failed = false;

    const fail = (err) => {
      if (failed) return; failed = true;
      out.destroy(); try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    };

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        const e = new Error('That file is larger than 25 MB'); e.status = 413;
        req.destroy(); fail(e);
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!bytes) { try { fs.unlinkSync(dest); } catch (_) {} 
        const e = new Error('The file was empty'); e.status = 400; return reject(e); }
      resolve({ id, size: bytes });
    });
    req.pipe(out);
  });
}

module.exports = { ready, receive, remove, exists, pathFor, contentType, isAllowed, MAX_BYTES, DIR };
