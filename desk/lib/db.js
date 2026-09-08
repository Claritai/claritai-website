'use strict';

const { Pool } = require('pg');

// Render's managed Postgres requires TLS. Locally (no sslmode in the URL) we skip it.
const url = process.env.DATABASE_URL || '';
const needsSsl = /render\.com|amazonaws\.com/.test(url) && !/sslmode=disable/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
});

// The record types the Desk stores. Each row is {id, data jsonb, updated_at}:
// the app works in whole records, so a document shape keeps the API thin and means
// adding a field to a form never needs a migration. JSONB is still fully queryable.
const COLLECTIONS = ['leads', 'clients', 'deals', 'docs', 'tasks', 'meetings', 'sites', 'social'];

async function init() {
  const client = await pool.connect();
  try {
    for (const name of COLLECTIONS) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${name} (
          id          TEXT PRIMARY KEY,
          data        JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by  TEXT
        )
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${name}_updated_at_idx ON ${name} (updated_at DESC)`
      );
    }
    // Append-only trail of who changed what, so "who moved this deal?" is answerable.
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity (
        id          BIGSERIAL PRIMARY KEY,
        at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor       TEXT,
        action      TEXT,
        collection  TEXT,
        record_id   TEXT,
        summary     TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS activity_at_idx ON activity (at DESC)`);

    // Staff roster. Filled in as people sign in, so the owner dropdowns list
    // real colleagues instead of names somebody typed.
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email      TEXT PRIMARY KEY,
        name       TEXT,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } finally {
    client.release();
  }
}

function assertCollection(name) {
  if (!COLLECTIONS.includes(name)) {
    const err = new Error('Unknown collection: ' + name);
    err.status = 404;
    throw err;
  }
  return name;
}

async function list(collection) {
  assertCollection(collection);
  const { rows } = await pool.query(
    `SELECT id, data, updated_at, updated_by FROM ${collection} ORDER BY updated_at DESC`
  );
  return rows.map((r) => Object.assign({ id: r.id }, r.data, {
    _updatedAt: r.updated_at,
    _updatedBy: r.updated_by,
  }));
}

async function get(collection, id) {
  assertCollection(collection);
  const { rows } = await pool.query(`SELECT id, data FROM ${collection} WHERE id = $1`, [id]);
  if (!rows.length) return null;
  return Object.assign({ id: rows[0].id }, rows[0].data);
}

// Whole-record write. The client always sends the complete record, so this is an upsert.
async function put(collection, id, data, actor) {
  assertCollection(collection);
  const body = Object.assign({}, data);
  delete body.id;
  delete body._updatedAt;
  delete body._updatedBy;
  await pool.query(
    `INSERT INTO ${collection} (id, data, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now(), updated_by = $3`,
    [id, JSON.stringify(body), actor || null]
  );
  return Object.assign({ id }, body);
}

// Merge a few fields into an existing record without sending the whole thing.
// Used by the site-check cron so it can never clobber a field a person is editing.
async function patch(collection, id, fields, actor) {
  assertCollection(collection);
  const { rows } = await pool.query(
    `UPDATE ${collection}
        SET data = data || $2::jsonb, updated_at = now(), updated_by = $3
      WHERE id = $1
      RETURNING id, data`,
    [id, JSON.stringify(fields), actor || null]
  );
  if (!rows.length) return null;
  return Object.assign({ id: rows[0].id }, rows[0].data);
}

async function remove(collection, id) {
  assertCollection(collection);
  await pool.query(`DELETE FROM ${collection} WHERE id = $1`, [id]);
}

async function recordUser(email, name) {
  try {
    await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, last_seen = now()`,
      [email, name || null]
    );
  } catch (_) { /* never block sign-in on the roster */ }
}

async function listTeam() {
  try {
    const { rows } = await pool.query('SELECT name, email FROM users ORDER BY name NULLS LAST, email');
    return rows.map((r) => r.name || r.email.split('@')[0]);
  } catch (_) {
    return [];
  }
}

async function logActivity(actor, action, collection, recordId, summary) {
  try {
    await pool.query(
      `INSERT INTO activity (actor, action, collection, record_id, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor || null, action, collection, recordId, summary || null]
    );
  } catch (_) {
    /* the trail is a nice-to-have; never fail a write because of it */
  }
}

module.exports = { pool, COLLECTIONS, init, list, get, put, patch, remove, logActivity, recordUser, listTeam };
