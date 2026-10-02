// Merges an imported Anki package into the collection.
// Notes are matched by GUID, so importing an updated export of the same deck updates it in place.
import type { SqlJsStatic } from 'sql.js';
import { db, newId } from '../data/db';
import { DEFAULT_PRESET_ID, ensureDeck, getSettings, normalizeTags, reservePositions } from '../data/repo';
import { forgetMediaUrls, mimeFor } from '../data/media';
import { defaultPreset } from '../domain/defaults';
import { type Card, CardState, type MediaFile, type Note, type NoteType, type Preset, type ReviewLogEntry } from '../domain/types';
import { readMediaFile, readPackage, type ImpDeckConfig, type ImpRevlog, type ImportBundle } from './apkg';
import type { BlobLike } from './zip';
import { convertRevlog, convertSchedule, deckOf, lastReviewedAt } from './convert';

export interface ImportOptions {
  /** Update notes, note types and card progress you already have when the file's copy is newer. */
  updateExisting: boolean;
}

export interface ImportSummary {
  notesAdded: number;
  notesUpdated: number;
  notesUnchanged: number;
  cardsAdded: number;
  cardsUpdated: number;
  reviewsAdded: number;
  noteTypesAdded: number;
  decks: string[];
  media: number;
  warnings: string[];
}

export type Progress = (stage: string, done: number, total: number) => void;

const CHUNK = 5000;

export async function importPackage(
  file: BlobLike,
  sql: SqlJsStatic,
  opts: ImportOptions,
  onProgress: Progress = () => {},
): Promise<ImportSummary> {
  onProgress('Reading file', 0, 1);
  const bundle = await readPackage(file, sql);
  return importBundle(bundle, opts, onProgress);
}

export async function importBundle(b: ImportBundle, opts: ImportOptions, onProgress: Progress = () => {}): Promise<ImportSummary> {
  const now = Date.now();
  await getSettings(); // ensure initialized
  const summary: ImportSummary = {
    notesAdded: 0, notesUpdated: 0, notesUnchanged: 0, cardsAdded: 0, cardsUpdated: 0,
    reviewsAdded: 0, noteTypesAdded: 0, decks: [], media: 0, warnings: [],
  };

  // Skip the placeholder note newer Anki versions put in the legacy file.
  if (b.notes.length === 1 && b.notes[0].fields[0]?.startsWith('Please update to the latest Anki version')) {
    throw new Error('This package needs a newer reader. Re-export it from Anki with “Support older Anki versions” turned off, then try again.');
  }

  // ----- note types -----
  onProgress('Note types', 0, 1);
  const usedMids = new Set(b.notes.map((n) => n.mid));
  const ntMap = new Map<number, NoteType>();
  const existingNts = await db.noteTypes.toArray();
  for (const imp of b.noteTypes) {
    if (!usedMids.has(imp.ankiId)) continue;
    let match = existingNts.find((nt) => nt.ankiId === imp.ankiId && nt.fields.length === imp.fields.length);
    if (!match) {
      // A stock type identical in structure (e.g. "Basic") is adopted instead of duplicated.
      const same = existingNts.find((nt) => !nt.ankiId && sameStructure(nt, imp));
      if (same) {
        match = { ...same, ankiId: imp.ankiId };
        await db.noteTypes.put(match);
      }
    }
    const shaped = {
      name: imp.name,
      kind: imp.kind,
      fields: imp.fields.map((name, ord) => ({ name, ord })),
      templates: imp.templates.map((t, ord) => ({ ...t, ord })),
      css: imp.css,
      sortField: Math.min(imp.sortField, Math.max(0, imp.fields.length - 1)),
    };
    if (match) {
      const changed = !sameStructure(match, imp) || match.css !== imp.css;
      const updated = opts.updateExisting && changed && match.ankiId === imp.ankiId && match.mtime < now ? { ...match, ...shaped, mtime: now } : match;
      if (updated !== match) await db.noteTypes.put(updated);
      ntMap.set(imp.ankiId, updated);
    } else {
      let name = imp.name;
      if (existingNts.some((nt) => nt.name === name)) name = `${imp.name} (Anki)`;
      const nt: NoteType = { id: newId(), ankiId: imp.ankiId, ...shaped, name, mtime: now };
      await db.noteTypes.add(nt);
      existingNts.push(nt);
      ntMap.set(imp.ankiId, nt);
      summary.noteTypesAdded++;
    }
  }

  // ----- decks & presets -----
  const configById = new Map(b.deckConfigs.map((c) => [c.ankiId, c]));
  const presetByConfig = new Map<number, Preset>();
  const presets = await db.presets.toArray();
  async function presetFor(cfgId: number): Promise<Preset> {
    const hit = presetByConfig.get(cfgId);
    if (hit) return hit;
    const cfg = configById.get(cfgId);
    let p: Preset | undefined = cfg ? presets.find((x) => x.ankiId === cfg.ankiId) : undefined;
    if (!p && cfg) {
      p = presetFromConfig(cfg, presets);
      await db.presets.add(p);
      presets.push(p);
    }
    p ??= (await db.presets.get(DEFAULT_PRESET_ID))!;
    presetByConfig.set(cfgId, p);
    return p;
  }

  const deckById = new Map(b.decks.map((d) => [d.ankiId, d]));
  const usedDecks = new Set(b.cards.map(deckOf));
  const localDeck = new Map<number, number>(); // anki deck id -> local deck id
  const deckPreset = new Map<number, Preset>(); // anki deck id -> preset used for conversion
  for (const ankiDeckId of usedDecks) {
    const imp = deckById.get(ankiDeckId);
    const name = imp && !imp.filtered ? imp.name : 'Default';
    const preset = await presetFor(imp?.configId ?? 1);
    const before = await db.decks.where('name').equalsIgnoreCase(name).first();
    const deck = before ?? (await ensureDeck(name, preset.id));
    if (!before) {
      await db.decks.update(deck.id, { presetId: preset.id, ankiId: ankiDeckId });
      summary.decks.push(deck.name);
    }
    localDeck.set(ankiDeckId, deck.id);
    deckPreset.set(ankiDeckId, before ? ((await db.presets.get(before.presetId)) ?? preset) : preset);
  }

  // ----- notes -----
  const guids = b.notes.map((n) => n.guid);
  const existingNotes = new Map<string, Note>();
  for (let i = 0; i < guids.length; i += CHUNK) {
    const found = await db.notes.where('guid').anyOf(guids.slice(i, i + CHUNK)).toArray();
    for (const n of found) existingNotes.set(n.guid, n);
  }
  const noteIdMap = new Map<number, number>(); // anki nid -> local note id
  const updatedNoteIds = new Set<number>();
  const newNotes: Note[] = [];
  const changedNotes: Note[] = [];
  const takenNoteIds = new Set((await db.notes.bulkGet(b.notes.map((n) => n.ankiId))).filter(Boolean).map((n) => n!.id));
  for (const imp of b.notes) {
    const nt = ntMap.get(imp.mid);
    if (!nt) {
      summary.warnings.push(`Skipped a note with an unknown note type (${imp.mid}).`);
      continue;
    }
    const fields = nt.fields.map((_, i) => imp.fields[i] ?? '');
    const existing = existingNotes.get(imp.guid);
    if (existing) {
      noteIdMap.set(imp.ankiId, existing.id);
      if (opts.updateExisting && existing.noteTypeId === nt.id && imp.mod * 1000 > existing.mtime &&
          (existing.fields.join('\x1f') !== fields.join('\x1f') || existing.tags.join(' ') !== imp.tags.join(' '))) {
        changedNotes.push({ ...existing, fields, tags: normalizeTags(imp.tags), mtime: imp.mod * 1000 });
        updatedNoteIds.add(existing.id);
        summary.notesUpdated++;
      } else summary.notesUnchanged++;
      continue;
    }
    const id = takenNoteIds.has(imp.ankiId) ? newId() : imp.ankiId;
    takenNoteIds.add(id);
    newNotes.push({ id, guid: imp.guid, noteTypeId: nt.id, fields, tags: normalizeTags(imp.tags), created: imp.ankiId, mtime: imp.mod * 1000 });
    noteIdMap.set(imp.ankiId, id);
    summary.notesAdded++;
  }
  for (let i = 0; i < newNotes.length; i += CHUNK) {
    onProgress('Notes', i, newNotes.length);
    await db.notes.bulkAdd(newNotes.slice(i, i + CHUNK));
  }
  if (changedNotes.length) await db.notes.bulkPut(changedNotes);

  // ----- cards -----
  const logsByCard = new Map<number, ImpRevlog[]>();
  for (const r of b.revlog) {
    if (!logsByCard.has(r.cid)) logsByCard.set(r.cid, []);
    logsByCard.get(r.cid)!.push(r);
  }
  for (const l of logsByCard.values()) l.sort((a, z) => a.id - z.id);

  const localNoteIds = [...new Set(noteIdMap.values())];
  const existingCards = new Map<string, Card>();
  for (let i = 0; i < localNoteIds.length; i += CHUNK) {
    const found = await db.cards.where('noteId').anyOf(localNoteIds.slice(i, i + CHUNK)).toArray();
    for (const c of found) existingCards.set(`${c.noteId}:${c.ord}`, c);
  }
  const takenCardIds = new Set((await db.cards.bulkGet(b.cards.map((c) => c.ankiId))).filter(Boolean).map((c) => c!.id));
  const newCount = b.cards.filter((c) => c.type === 0).length;
  const firstPos = await reservePositions(newCount);
  // keep Anki's new-card order (a new card's "due" is its position)
  const newRank = new Map<number, number>();
  b.cards
    .filter((c) => c.type === 0)
    .sort((a, z) => (a.odid ? a.odue : a.due) - (z.odid ? z.odue : z.due) || a.nid - z.nid || a.ord - z.ord)
    .forEach((c, i) => newRank.set(c.ankiId, i));
  const ordered = b.cards;

  const cardsToWrite: Card[] = [];
  const cardIdMap = new Map<number, number>(); // anki card id -> local card id (only cards whose history we import)
  for (const c of ordered) {
    const noteId = noteIdMap.get(c.nid);
    if (noteId === undefined) continue;
    const deckId = localDeck.get(deckOf(c));
    if (deckId === undefined) continue;
    const preset = deckPreset.get(deckOf(c)) ?? defaultPreset(DEFAULT_PRESET_ID);
    const log = logsByCard.get(c.ankiId) ?? [];
    const existing = existingCards.get(`${noteId}:${c.ord}`);
    if (existing) {
      const theirs = lastReviewedAt(c, log);
      const mine = existing.lastReview ?? 0;
      if (opts.updateExisting && theirs > mine) {
        const sched = convertSchedule(c, b.crt, now, preset, log);
        cardsToWrite.push({ ...existing, ...sched, mtime: now });
        cardIdMap.set(c.ankiId, existing.id);
        summary.cardsUpdated++;
      }
      continue;
    }
    const sched = convertSchedule(c, b.crt, now, preset, log);
    const id = takenCardIds.has(c.ankiId) ? newId() : c.ankiId;
    takenCardIds.add(id);
    const card: Card = {
      id,
      noteId,
      deckId,
      ord: c.ord,
      created: c.ankiId,
      mtime: now,
      position: sched.state === CardState.New ? firstPos + (newRank.get(c.ankiId) ?? 0) : 0,
      ...sched,
      buriedUntil: 0,
    };
    cardsToWrite.push(card);
    cardIdMap.set(c.ankiId, id);
    summary.cardsAdded++;
  }
  for (let i = 0; i < cardsToWrite.length; i += CHUNK) {
    onProgress('Cards', i, cardsToWrite.length);
    await db.cards.bulkPut(cardsToWrite.slice(i, i + CHUNK));
  }

  // ----- review history -----
  const logs: ReviewLogEntry[] = [];
  for (const r of b.revlog) {
    const cid = cardIdMap.get(r.cid);
    if (cid !== undefined) logs.push(convertRevlog(r, cid));
  }
  if (logs.length) {
    const existingLogIds = new Set<number>();
    for (let i = 0; i < logs.length; i += CHUNK) {
      const got = await db.revlog.bulkGet(logs.slice(i, i + CHUNK).map((l) => l.id));
      got.forEach((g) => g && existingLogIds.add(g.id));
    }
    const fresh = logs.filter((l) => !existingLogIds.has(l.id));
    for (let i = 0; i < fresh.length; i += CHUNK) {
      onProgress('Review history', i, fresh.length);
      await db.revlog.bulkAdd(fresh.slice(i, i + CHUNK));
    }
    summary.reviewsAdded = fresh.length;
  }

  // ----- media -----
  await importMedia(b, summary, onProgress);
  onProgress('Done', 1, 1);
  return summary;
}

async function importMedia(b: ImportBundle, summary: ImportSummary, onProgress: Progress) {
  const total = b.media.length;
  let batch: MediaFile[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await db.media.bulkPut(batch);
    batch = [];
    batchBytes = 0;
  };
  for (let i = 0; i < total; i++) {
    const m = b.media[i];
    if (i % 25 === 0) onProgress('Media', i, total);
    try {
      const data = await readMediaFile(b, m);
      if (!data) {
        summary.warnings.push(`Media file “${m.name}” is listed but missing from the package.`);
        continue;
      }
      const blob = new Blob([data as BlobPart], { type: mimeFor(m.name) });
      batch.push({ name: m.name, blob, size: blob.size });
      batchBytes += blob.size;
      summary.media++;
      if (batch.length >= 100 || batchBytes > 16_000_000) await flush();
    } catch (e) {
      summary.warnings.push(`Couldn’t read media “${m.name}”: ${(e as Error).message}`);
    }
  }
  await flush();
  forgetMediaUrls();
}

function presetFromConfig(cfg: ImpDeckConfig, existing: Preset[]): Preset {
  const base = defaultPreset(newId(), cfg.name);
  let name = cfg.name;
  if (existing.some((p) => p.name === name)) name = `${cfg.name} (Anki)`;
  return {
    ...base,
    name,
    ankiId: cfg.ankiId,
    newPerDay: cfg.newPerDay,
    reviewsPerDay: cfg.reviewsPerDay,
    learningSteps: cfg.learnSteps,
    relearningSteps: cfg.relearnSteps,
    desiredRetention: cfg.desiredRetention >= 0.7 && cfg.desiredRetention <= 0.99 ? cfg.desiredRetention : 0.9,
    maximumInterval: cfg.maxInterval,
    fsrsParams: cfg.fsrsParams,
    buryNew: cfg.buryNew,
    buryReviews: cfg.buryReviews,
    leechThreshold: cfg.leechThreshold,
    leechAction: cfg.leechSuspend ? 'suspend' : 'tag',
    newOrder: cfg.randomNewOrder ? 'random' : 'added',
  };
}

function sameStructure(nt: NoteType, imp: { name: string; kind: string; fields: string[]; templates: { qfmt: string; afmt: string }[] }): boolean {
  return (
    nt.name === imp.name &&
    nt.kind === imp.kind &&
    nt.fields.map((f) => f.name).join('\x1f') === imp.fields.join('\x1f') &&
    nt.templates.length === imp.templates.length &&
    nt.templates.every((t, i) => t.qfmt.trim() === imp.templates[i].qfmt.trim() && t.afmt.trim() === imp.templates[i].afmt.trim())
  );
}
