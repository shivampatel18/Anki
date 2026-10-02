import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { RecallDB, useDatabase } from '../src/data/db';
import { ensureInitialized } from '../src/data/repo';

export async function freshDb() {
  const d = new RecallDB('test-' + Math.random().toString(36).slice(2));
  useDatabase(d);
  await ensureInitialized();
  return d;
}

export function fixture(name: string): Blob {
  const buf = readFileSync(join(__dirname, '..', 'fixtures', name));
  return new Blob([buf]);
}

let sql: Awaited<ReturnType<typeof initSqlJs>> | undefined;
export async function getSql() {
  sql ??= await initSqlJs();
  return sql;
}
