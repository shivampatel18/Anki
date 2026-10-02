// Media files (images, audio) stored as blobs, resolved to object URLs for display.
import { db } from './db';
import { escapeHtml } from '../domain/template';

const urls = new Map<string, string>();
/** src="a b.png" | src='a b.png' | src=a.png */
const SRC_RE = /(\bsrc=)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export function mimeFor(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export async function putMedia(name: string, data: Uint8Array | Blob): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeFor(name) });
  await db.media.put({ name, blob, size: blob.size });
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old), urls.delete(name);
}

/** Store a user-picked file under a unique name and return that name. */
export async function addMediaFile(file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const base = file.name.slice(0, file.name.length - ext.length).replace(/[^\w\-. ]+/g, '_') || 'file';
  let name = base + ext;
  for (let i = 1; await db.media.get(name); i++) name = `${base}-${i}${ext}`;
  await putMedia(name, file);
  return name;
}

/** Drop cached object URLs (after media was replaced in bulk). */
export function forgetMediaUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

export async function mediaUrl(name: string): Promise<string | undefined> {
  const hit = urls.get(name);
  if (hit) return hit;
  const m = await db.media.get(name);
  if (!m) return undefined;
  const url = URL.createObjectURL(m.blob);
  urls.set(name, url);
  return url;
}

/**
 * Prepare card HTML for display: point <img>/<audio>/<video> at stored media and turn
 * [sound:file] tags into play buttons. Returns the HTML and the sounds in order.
 */
export async function resolveMedia(html: string): Promise<{ html: string; sounds: string[] }> {
  const names = new Set<string>();
  for (const m of html.matchAll(SRC_RE)) names.add(m[2] ?? m[3] ?? m[4]);
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) names.add(m[1]);
  const resolved = new Map<string, string>();
  await Promise.all(
    [...names].map(async (n) => {
      if (/^(https?:|data:|blob:)/.test(n)) return;
      const decoded = safeDecode(n);
      const url = (await mediaUrl(decoded)) ?? (await mediaUrl(n));
      if (url) resolved.set(n, url);
    }),
  );
  const sounds: string[] = [];
  let out = html.replace(SRC_RE, (m, attr: string, dq?: string, sq?: string, bare?: string) => {
    const url = resolved.get(dq ?? sq ?? bare ?? '');
    return url ? `${attr}"${url}"` : m;
  });
  out = out.replace(/\[sound:([^\]]+)\]/g, (_m, name) => {
    const url = resolved.get(name);
    if (!url) return `<span class="missing-media">Missing audio: ${escapeHtml(name)}</span>`;
    sounds.push(url);
    return `<button type="button" class="replay-button" data-sound="${url}" aria-label="Play audio"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>`;
  });
  return { html: out, sounds };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function mediaUsage(): Promise<{ count: number; bytes: number }> {
  let bytes = 0, count = 0;
  await db.media.each((m) => {
    bytes += m.size;
    count++;
  });
  return { count, bytes };
}
