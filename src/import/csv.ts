// Plain-text import: CSV / TSV, including the "#separator:tab" headers Anki writes when exporting notes.
import { db } from '../data/db';
import { addNote } from '../data/repo';
import { escapeHtml, stripHtml } from '../domain/template';

export interface ParsedText {
  rows: string[][];
  separator: string;
  html: boolean;
  tagsColumn?: number; // 0-based
  columns: number;
}

export function parseDelimited(text: string): ParsedText {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let separator: string | undefined;
  let html = true;
  let tagsColumn: number | undefined;
  let i = 0;
  for (; i < lines.length && lines[i].startsWith('#'); i++) {
    const m = /^#([a-z ]+):(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (key === 'separator') separator = ({ tab: '\t', comma: ',', semicolon: ';', space: ' ', pipe: '|', colon: ':' } as Record<string, string>)[val.toLowerCase()] ?? val;
    else if (key === 'html') html = val.toLowerCase() === 'true';
    else if (key === 'tags column') tagsColumn = Number(val) - 1;
  }
  const body = lines.slice(i).join('\n');
  if (!separator) {
    const sample = lines.slice(i, i + 5).join('\n');
    const counts = ['\t', ';', ','].map((s) => [s, sample.split(s).length] as const).sort((a, b) => b[1] - a[1]);
    separator = counts[0][1] > 1 ? counts[0][0] : '\t';
  }
  const rows = parseRows(body, separator).filter((r) => r.some((c) => c.trim() !== ''));
  const columns = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows, separator, html, tagsColumn, columns };
}

function parseRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows;
}

export interface TextImportPlan {
  noteTypeId: number;
  deckId: number;
  /** For each note-type field, which column feeds it (null = leave empty). */
  fieldColumns: (number | null)[];
  tagsColumn: number | null;
  extraTags: string[];
  html: boolean;
  skipDuplicates: boolean;
}

export interface TextImportResult {
  added: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

export async function importRows(rows: string[][], plan: TextImportPlan, onProgress?: (done: number, total: number) => void): Promise<TextImportResult> {
  const res: TextImportResult = { added: 0, duplicates: 0, failed: 0, errors: [] };
  const existing = new Set(
    (await db.notes.where('noteTypeId').equals(plan.noteTypeId).toArray()).map((n) => stripHtml(n.fields[0] ?? '').toLowerCase()),
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fields = plan.fieldColumns.map((col) => {
      const v = col === null ? '' : (r[col] ?? '');
      return plan.html ? v : escapeHtml(v).replace(/\n/g, '<br>');
    });
    const key = stripHtml(fields[0] ?? '').toLowerCase();
    if (plan.skipDuplicates && key && existing.has(key)) {
      res.duplicates++;
      continue;
    }
    const tags = [...plan.extraTags, ...(plan.tagsColumn !== null ? (r[plan.tagsColumn] ?? '').split(/\s+/) : [])];
    try {
      await addNote(plan.noteTypeId, plan.deckId, fields, tags);
      existing.add(key);
      res.added++;
    } catch (e) {
      res.failed++;
      if (res.errors.length < 5) res.errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
    if (onProgress && i % 50 === 0) onProgress(i, rows.length);
  }
  return res;
}
