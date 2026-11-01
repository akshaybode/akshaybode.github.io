import * as duckdb from './vendor/duckdb/duckdb-browser-bundle.mjs';

let connectionPromise;
let setupPromise;
let runQueue = Promise.resolve();

async function connection() {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const workerUrl = new URL('./vendor/duckdb/duckdb-browser-mvp.worker.js', import.meta.url);
      const wasmUrl = new URL('./vendor/duckdb/duckdb-mvp.wasm', import.meta.url);
      const worker = new Worker(workerUrl);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      await db.instantiate(wasmUrl.href);
      await db.open({
        path: ':memory:',
        query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true }
      });
      return db.connect();
    })().catch(error => { connectionPromise = null; throw error; });
  }
  return connectionPromise;
}

async function setupStatements() {
  if (!setupPromise) {
    setupPromise = fetch(new URL('./setup.sql', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Could not load the sample data.');
      return response.text();
    }).then(source => source
      .replace(/NUMBER\(/g, 'DECIMAL(')
      .replace(/TIMESTAMP_NTZ/g, 'TIMESTAMP')
      .split(';')
      .map(statement => statement.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
      .filter(statement => statement && !/^(CREATE DATABASE|CREATE SCHEMA|USE SCHEMA)\b/i.test(statement)));
  }
  return setupPromise;
}

function normalize(value, field) {
  if (value === null || value === undefined) return null;
  if (/^Date/i.test(String(field.type)) && typeof value === 'number') {
    const iso = new Date(value).toISOString().replace('T', ' ').replace('Z', '').replace(/\.000$/, '');
    return /^Date32/i.test(String(field.type)) ? iso.slice(0, 10) : iso;
  }
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) {
    const iso = value.toISOString().replace('T', ' ').replace('Z', '');
    return iso.endsWith(' 00:00:00.000') ? iso.slice(0, 10) : iso.replace(/\.000$/, '');
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const text = value.toString();
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  }
  return value;
}

async function runOnce(sql) {
  const stripped = sql.replace(/^\s*(?:--[^\n]*(?:\n|$)\s*)*/, '').trim().replace(/;\s*$/, '');
  if (!/^(SELECT|WITH)\b/i.test(stripped) || stripped.includes(';')) {
    throw new Error('Run one SELECT or WITH query at a time. Write setup or MERGE statements in Snowflake.');
  }
  const conn = await connection();
  for (const statement of await setupStatements()) await conn.query(statement);
  const result = await conn.query(stripped);
  const fields = result.schema.fields;
  const columns = fields.map(field => field.name);
  const rows = result.toArray().map(row => {
    const object = row.toJSON();
    return fields.map(field => normalize(object[field.name], field));
  });
  return { columns, rows };
}

export function runQuery(sql) {
  const pending = runQueue.then(() => runOnce(sql));
  runQueue = pending.catch(() => {});
  return pending;
}
