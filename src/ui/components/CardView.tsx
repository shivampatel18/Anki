// Renders card HTML inside a shadow root so a note type's CSS can't leak into the app (or vice versa).
import { useEffect, useRef } from 'react';
import { resolveMedia } from '../../data/media';
import { useIsDark } from '../theme';

const BASE_CSS = `
:host { display: block; color: var(--card-ink); }
*, *::before, *::after { box-sizing: border-box; }
.card { background: transparent !important; overflow-wrap: anywhere; min-height: 1em; }
.card.dark { color: var(--card-ink) !important; }
img { max-width: 100%; height: auto; }
video { max-width: 100%; }
hr#answer { border: 0; border-top: 1.5px dashed var(--line); margin: 22px 0; }
.cloze { font-weight: 600; color: var(--cloze); }
.cloze-inactive { }
.replay-button { display: inline-grid; place-items: center; width: 40px; height: 40px; margin: 2px 4px; vertical-align: middle;
  border-radius: 50%; border: 1px solid var(--line); background: var(--paper); color: var(--primary); cursor: pointer; }
.missing-media { color: var(--danger); font-size: 0.8em; }
.unknown-field { color: var(--danger); font-size: 0.8em; }
input#typeans { width: 100%; max-width: 420px; min-height: 46px; margin-top: 16px; padding: 10px 12px; font: 17px var(--ui);
  border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); }
code#typeans { display: inline-block; font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; line-height: 1.6; padding: 6px 8px; border-radius: 6px; }
.typeGood { background: color-mix(in srgb, var(--good) 22%, transparent); }
.typeBad { background: color-mix(in srgb, var(--again) 25%, transparent); }
.typeMissed { background: color-mix(in srgb, var(--ink-3) 25%, transparent); }
a.hint { color: var(--primary); }
ruby rt { font-size: 0.55em; }
`;

interface Props {
  html: string;
  css: string;
  autoplay?: boolean;
  /** Called after each render with the shadow root (e.g. to find the type-in box). */
  onRendered?: (root: ShadowRoot) => void;
}

export function CardView({ html, css, autoplay, onRendered }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const dark = useIsDark();

  useEffect(() => {
    const el = host.current!;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      root.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest?.('.replay-button') as HTMLElement | null;
        if (btn?.dataset.sound) {
          e.stopPropagation();
          playSequence([btn.dataset.sound]);
        }
      });
    }
    const my = ++seq.current;
    resolveMedia(html).then(({ html: resolved, sounds }) => {
      if (my !== seq.current) return;
      root.innerHTML = `<style>${BASE_CSS}\n${css}</style><div class="card${dark ? ' dark nightMode night_mode' : ''}">${resolved}</div>`;
      onRendered?.(root);
      if (autoplay && sounds.length) playSequence(sounds);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css, dark]);

  return <div ref={host} />;
}

let current: HTMLAudioElement | undefined;
export function playSequence(urls: string[]) {
  current?.pause();
  const [first, ...rest] = urls;
  if (!first) return;
  const a = new Audio(first);
  current = a;
  a.onended = () => rest.length && playSequence(rest);
  a.play().catch(() => {
    /* autoplay blocked until the next tap; the play button still works */
  });
}

export function stopAudio() {
  current?.pause();
  current = undefined;
}
