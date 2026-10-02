// Full backups: one .zip with the collection as JSON plus every media file.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { db } from './db';
import { mimeFor } from './media';

const FORMAT = 'recall-backup';
const VERSION = 1;

export async function exportBackup(includeMedia = true): Promise<Blob> {
  const data = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: await db.settings.toArray(),
    presets: await db.presets.toArray(),
    decks: await db.decks.toArray(),
    noteTypes: await db.noteTypes.toArray(),
    notes: await db.notes.toArray(),
    cards: await db.cards.toArray(),
    revlog: await db.revlog.toArray(),
  };
  const files: Zippable = { 'collection.json': [strToU8(JSON.stringify(data)), { level: 6 }] };
  if (includeMedia) {
    const names: string[] = [];
    await db.media.each((m) => void names.push(m.name));
    for (const name of names) {
      const m = await db.media.get(name);
      if (m) files[`media/${encodeURIComponent(name)}`] = [new Uint8Array(await m.blob.arrayBuffer()), { level: 0 }];
    }
  }
  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
}

/** Replace the whole collection with a backup. */
export async function restoreBackup(file: Blob): Promise<{ notes: number; cards: number; media: number }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const json = entries['collection.json'];
  if (!json) throw new Error('This isn’t a Recall backup (collection.json is missing).');
  const data = JSON.parse(strFromU8(json));
  if (data.format !== FORMAT) throw new Error('This isn’t a Recall backup.');
  let media = 0;
  await db.transaction('rw', [db.settings, db.presets, db.decks, db.noteTypes, db.notes, db.cards, db.revlog, db.media], async () => {
    await Promise.all([db.settings.clear(), db.presets.clear(), db.decks.clear(), db.noteTypes.clear(), db.notes.clear(), db.cards.clear(), db.revlog.clear(), db.media.clear()]);
    await db.settings.bulkPut(data.settings);
    await db.presets.bulkPut(data.presets);
    await db.decks.bulkPut(data.decks);
    await db.noteTypes.bulkPut(data.noteTypes);
    await db.notes.bulkPut(data.notes);
    await db.cards.bulkPut(data.cards);
    await db.revlog.bulkPut(data.revlog);
    for (const [path, bytes] of Object.entries(entries)) {
      if (!path.startsWith('media/')) continue;
      const name = decodeURIComponent(path.slice(6));
      const blob = new Blob([bytes as BlobPart], { type: mimeFor(name) });
      await db.media.put({ name, blob, size: blob.size });
      media++;
    }
  });
  return { notes: data.notes.length, cards: data.cards.length, media };
}

export async function eraseEverything(): Promise<void> {
  await db.delete();
  location.reload();
}
