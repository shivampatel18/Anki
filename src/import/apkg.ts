// Reads Anki deck packages (.apkg) and collection packages (.colpkg) into a neutral bundle.
// Handles every format Anki has written: legacy collection.anki2 / .anki21 (schema 11, JSON config)
// and the current collection.anki21b (zstd-compressed, schema 18, protobuf config).
import type { Database, SqlJsStatic } from 'sql.js';
import { ZipReader, maybeZstd, type BlobLike } from './zip';
import { PbMessage } from './protobuf';
import { minutesToStep } from '../domain/scheduler';

export interface ImpNoteType {
  ankiId: number;
  name: string;
  kind: 'normal' | 'cloze';
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
  css: string;
  sortField: number;
}

export interface ImpDeck {
  ankiId: number;
  name: string;
  configId: number;
  filtered: boolean;
}

export interface ImpDeckConfig {
  ankiId: number;
  name: string;
  learnSteps: string[];
  relearnSteps: string[];
  newPerDay: number;
  reviewsPerDay: number;
  maxInterval: number;
  desiredRetention: number;
  fsrsParams: number[];
  buryNew: boolean;
  buryReviews: boolean;
  leechThreshold: number;
  leechSuspend: boolean;
  randomNewOrder: boolean;
}

export interface ImpNote {
  ankiId: number;
  guid: string;
  mid: number;
  mod: number; // seconds
  tags: string[];
  fields: string[];
}

export interface ImpCard {
  ankiId: number;
  nid: number;
  did: number;
  ord: number;
  mod: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
  data: string;
}

export interface ImpRevlog {
  id: number;
  cid: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface ImpMedia {
  name: string;
  entry: string;
}

export interface ImportBundle {
  format: 'legacy1' | 'legacy2' | 'latest';
  /** Collection creation time (seconds); review due dates are days after this. */
  crt: number;
  noteTypes: ImpNoteType[];
  decks: ImpDeck[];
  deckConfigs: ImpDeckConfig[];
  notes: ImpNote[];
  cards: ImpCard[];
  revlog: ImpRevlog[];
  media: ImpMedia[];
  zip: ZipReader;
}

function rows<T = Record<string, unknown>>(db: Database, sql: string): T[] {
  const out: T[] = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) out.push(stmt.getAsObject() as T);
  } finally {
    stmt.free();
  }
  return out;
}

function hasTable(db: Database, name: string): boolean {
  return rows(db, `select name from sqlite_master where type='table' and name='${name}'`).length > 0;
}

const splitTags = (s: string) => s.split(/\s+/).map((t) => t.trim()).filter(Boolean);

export async function readPackage(file: BlobLike, sql: SqlJsStatic): Promise<ImportBundle> {
  const zip = await ZipReader.open(file);
  let format: ImportBundle['format'];
  let colName: string;
  if (zip.has('collection.anki21b')) (format = 'latest'), (colName = 'collection.anki21b');
  else if (zip.has('collection.anki21')) (format = 'legacy2'), (colName = 'collection.anki21');
  else if (zip.has('collection.anki2')) (format = 'legacy1'), (colName = 'collection.anki2');
  else throw new Error('This file doesn’t contain an Anki collection. Export it from Anki as a deck package (.apkg).');

  const raw = maybeZstd(await zip.read(colName));
  const db = new sql.Database(raw);
  try {
    const col = rows<{ crt: number; ver: number; models: string; decks: string; dconf: string }>(db, 'select crt, ver, models, decks, dconf from col')[0];
    if (!col) throw new Error('The collection inside this file is empty.');
    const schema18 = hasTable(db, 'notetypes');

    const noteTypes = schema18 ? readNoteTypes18(db) : readNoteTypesJson(col.models);
    const decks = schema18 ? readDecks18(db) : readDecksJson(col.decks);
    const deckConfigs = schema18 ? readDeckConfigs18(db) : readDeckConfigsJson(col.dconf);

    const notes = rows<{ id: number; guid: string; mid: number; mod: number; tags: string; flds: string }>(
      db,
      'select id, guid, mid, mod, tags, flds from notes',
    ).map((n) => ({ ankiId: n.id, guid: n.guid, mid: n.mid, mod: n.mod, tags: splitTags(n.tags), fields: n.flds.split('\x1f') }));

    const cards = rows<Record<string, number | string>>(
      db,
      'select id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data from cards',
    ).map((c) => ({
      ankiId: c.id as number,
      nid: c.nid as number,
      did: c.did as number,
      ord: c.ord as number,
      mod: c.mod as number,
      type: c.type as number,
      queue: c.queue as number,
      due: c.due as number,
      ivl: c.ivl as number,
      factor: c.factor as number,
      reps: c.reps as number,
      lapses: c.lapses as number,
      left: c.left as number,
      odue: c.odue as number,
      odid: c.odid as number,
      flags: c.flags as number,
      data: String(c.data ?? ''),
    }));

    const revlog = rows<ImpRevlog>(db, 'select id, cid, ease, ivl, lastIvl, factor, time, type from revlog');
    const media = await readMediaIndex(zip, format);

    return { format, crt: col.crt, noteTypes, decks, deckConfigs, notes, cards, revlog, media, zip };
  } finally {
    db.close();
  }
}

// ---------- schema 11 (JSON in the col table) ----------

function readNoteTypesJson(json: string): ImpNoteType[] {
  const models = JSON.parse(json || '{}') as Record<string, any>;
  return Object.values(models).map((m) => ({
    ankiId: Number(m.id),
    name: String(m.name),
    kind: m.type === 1 ? 'cloze' : 'normal',
    fields: [...m.flds].sort((a: any, b: any) => a.ord - b.ord).map((f: any) => String(f.name)),
    templates: [...m.tmpls].sort((a: any, b: any) => a.ord - b.ord).map((t: any) => ({ name: String(t.name), qfmt: String(t.qfmt), afmt: String(t.afmt) })),
    css: String(m.css ?? ''),
    sortField: Number(m.sortf ?? 0),
  }));
}

function readDecksJson(json: string): ImpDeck[] {
  const decks = JSON.parse(json || '{}') as Record<string, any>;
  return Object.values(decks).map((d) => ({
    ankiId: Number(d.id),
    name: String(d.name),
    configId: Number(d.conf ?? 1),
    filtered: !!d.dyn,
  }));
}

function readDeckConfigsJson(json: string): ImpDeckConfig[] {
  const confs = JSON.parse(json || '{}') as Record<string, any>;
  return Object.values(confs).map((c) => {
    const params: number[] =
      (c.fsrsParams6?.length && c.fsrsParams6) || (c.fsrsParams5?.length && c.fsrsParams5) || (c.fsrsWeights?.length && c.fsrsWeights) || [];
    return {
      ankiId: Number(c.id),
      name: String(c.name),
      learnSteps: (c.new?.delays ?? [1, 10]).map(minutesToStep),
      relearnSteps: (c.lapse?.delays ?? [10]).map(minutesToStep),
      newPerDay: Number(c.new?.perDay ?? 20),
      reviewsPerDay: Number(c.rev?.perDay ?? 200),
      maxInterval: Number(c.rev?.maxIvl ?? 36500),
      desiredRetention: Number(c.desiredRetention ?? 0.9),
      fsrsParams: params.map(Number),
      buryNew: !!c.new?.bury,
      buryReviews: !!c.rev?.bury,
      leechThreshold: Number(c.lapse?.leechFails ?? 8),
      leechSuspend: (c.lapse?.leechAction ?? 1) === 0,
      randomNewOrder: c.new?.order === 0,
    };
  });
}

// ---------- schema 18 (tables + protobuf blobs) ----------

function readNoteTypes18(db: Database): ImpNoteType[] {
  const nts = rows<{ id: number; name: string; config: Uint8Array }>(db, 'select id, name, config from notetypes');
  const fields = rows<{ ntid: number; ord: number; name: string }>(db, 'select ntid, ord, name from fields order by ntid, ord');
  const tmpls = rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(db, 'select ntid, ord, name, config from templates order by ntid, ord');
  return nts.map((nt) => {
    const cfg = PbMessage.decode(nt.config);
    return {
      ankiId: nt.id,
      name: nt.name,
      kind: cfg.int(1) === 1 ? 'cloze' : 'normal',
      fields: fields.filter((f) => f.ntid === nt.id).map((f) => f.name),
      templates: tmpls
        .filter((t) => t.ntid === nt.id)
        .map((t) => {
          const tc = PbMessage.decode(t.config);
          return { name: t.name, qfmt: tc.string(1), afmt: tc.string(2) };
        }),
      css: cfg.string(3),
      sortField: cfg.int(2),
    };
  });
}

function readDecks18(db: Database): ImpDeck[] {
  return rows<{ id: number; name: string; kind: Uint8Array }>(db, 'select id, name, kind from decks').map((d) => {
    const kind = PbMessage.decode(d.kind);
    const normal = kind.message(1);
    return {
      ankiId: d.id,
      name: d.name.replace(/\x1f/g, '::'),
      configId: normal ? normal.int(1, 1) : 1,
      filtered: !normal && !!kind.bytes(2),
    };
  });
}

function readDeckConfigs18(db: Database): ImpDeckConfig[] {
  return rows<{ id: number; name: string; config: Uint8Array }>(db, 'select id, name, config from deck_config').map((r) => {
    const c = PbMessage.decode(r.config);
    const p6 = c.floats(6), p5 = c.floats(5), p4 = c.floats(3);
    // proto3: absent fields are zero / empty, not "Anki's default"
    const learn = c.floats(1);
    const relearn = c.floats(2);
    return {
      ankiId: r.id,
      name: r.name,
      learnSteps: learn.map(minutesToStep),
      relearnSteps: relearn.map(minutesToStep),
      newPerDay: c.int(9, 0),
      reviewsPerDay: c.int(10, 0),
      maxInterval: c.int(16, 36500) || 36500,
      desiredRetention: c.float(37, 0.9) || 0.9,
      fsrsParams: (p6.length ? p6 : p5.length ? p5 : p4).map((x) => Math.round(x * 1e4) / 1e4),
      buryNew: c.bool(27),
      buryReviews: c.bool(28),
      leechThreshold: c.int(22, 8),
      leechSuspend: c.int(21, 0) === 0,
      randomNewOrder: c.int(20, 0) === 1,
    };
  });
}

// ---------- media ----------

async function readMediaIndex(zip: ZipReader, format: ImportBundle['format']): Promise<ImpMedia[]> {
  if (!zip.has('media')) return [];
  const raw = await zip.read('media');
  if (format === 'latest' || raw[0] !== 0x7b /* { */) {
    const msg = PbMessage.decode(maybeZstd(raw));
    return msg.messages(1).map((e, i) => ({ name: e.string(1), entry: String(e.fields.has(255) ? e.int(255) : i) }));
  }
  const map = JSON.parse(new TextDecoder().decode(raw) || '{}') as Record<string, string>;
  return Object.entries(map).map(([entry, name]) => ({ name, entry }));
}

export async function readMediaFile(bundle: ImportBundle, m: ImpMedia): Promise<Uint8Array | undefined> {
  if (!bundle.zip.has(m.entry)) return undefined;
  const data = await bundle.zip.read(m.entry);
  return bundle.format === 'latest' ? maybeZstd(data) : data;
}
