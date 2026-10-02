import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app-state';
import { countsFor, loadSnapshot, nextCard, type DaySnapshot, type QueueCounts } from '../../data/queue';
import { answerCard, undoAnswer, type UndoEntry } from '../../data/review';
import { db } from '../../data/db';
import { buryCards, deleteNotes, setFlag, setSuspended } from '../../data/repo';
import { GRADE_NAMES, GRADES, preview, type AnswerGrade, type AnswerPreview } from '../../domain/scheduler';
import { renderCard, type RenderContext } from '../../domain/template';
import { formatInterval, MINUTE } from '../../domain/time';
import { type Card, CardState, FLAG_COLORS, FLAG_NAMES } from '../../domain/types';
import { CardView, stopAudio } from '../components/CardView';
import { ActionSheet, ConfirmSheet } from '../components/Sheet';
import { IconClose, IconMore, IconUndo } from '../components/Icons';

interface Current {
  card: Card;
  queue: 'new' | 'learn' | 'review';
  ctx: RenderContext;
  question: string;
  answer?: string;
  css: string;
  previews?: AnswerPreview[];
  shownAt: number;
}

type Status = { kind: 'loading' } | { kind: 'card' } | { kind: 'waiting'; until: number } | { kind: 'done' } | { kind: 'error'; message: string };

const GRADE_CLASS: Record<AnswerGrade, string> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

export function StudyScreen({ deckId }: { deckId: number }) {
  const app = useApp();
  const snap = useRef<DaySnapshot | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [cur, setCur] = useState<Current | null>(null);
  const [counts, setCounts] = useState<QueueCounts>({ newCount: 0, learnCount: 0, reviewCount: 0 });
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [sheet, setSheet] = useState<'menu' | 'flag' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const typeBox = useRef<HTMLInputElement | null>(null);
  const deckName = useRef('');

  const show = useCallback(async (avoid?: number) => {
    const s = snap.current!;
    const now = Date.now();
    const next = nextCard(s, deckId, now, avoid);
    setCounts(countsFor(s, deckId));
    if (next.kind !== 'card') {
      setCur(null);
      setStatus(next);
      return;
    }
    const card = next.card;
    const note = await db.notes.get(card.noteId);
    const noteType = note && (await db.noteTypes.get(note.noteTypeId));
    const deck = await db.decks.get(card.deckId);
    if (!note || !noteType) {
      setStatus({ kind: 'error', message: 'This card’s note is missing. Try Browse › Check for problems.' });
      return;
    }
    const ctx: RenderContext = { noteType, fields: note.fields, tags: note.tags, deckName: deck?.name ?? '', cardOrd: card.ord, flag: card.flag };
    const r = renderCard(ctx);
    typeBox.current = null;
    setCur({ card, queue: next.queue, ctx, question: r.question, css: r.css, shownAt: Date.now() });
    setStatus({ kind: 'card' });
  }, [deckId]);

  const reload = useCallback(async () => {
    snap.current = await loadSnapshot();
    const d = await db.decks.get(deckId);
    deckName.current = d?.name ?? '';
    await show();
  }, [deckId, show]);

  useEffect(() => {
    reload().catch((e) => setStatus({ kind: 'error', message: (e as Error).message }));
    return () => stopAudio();
  }, [reload]);

  // come back when the next learning card is due
  useEffect(() => {
    if (status.kind !== 'waiting') return;
    const ms = Math.max(1000, Math.min(status.until - Date.now() + 500, 60_000));
    const t = window.setTimeout(() => show(), ms);
    return () => window.clearTimeout(t);
  }, [status, show]);

  const reveal = useCallback(() => {
    if (!cur || cur.answer !== undefined) return;
    const typed = typeBox.current?.value;
    const r = renderCard(cur.ctx, typed);
    const preset = snap.current!.presets.get(snap.current!.decks.find((d) => d.id === cur.card.deckId)?.presetId ?? 1) ?? [...snap.current!.presets.values()][0];
    setCur({ ...cur, answer: r.answer, previews: preview(cur.card, preset, Date.now()) });
  }, [cur]);

  const grade = useCallback(
    async (g: AnswerGrade) => {
      if (!cur || cur.answer === undefined || busy) return;
      setBusy(true);
      try {
        const out = await answerCard(snap.current!, cur.card.id, g, Date.now() - cur.shownAt);
        setUndo((u) => [...u.slice(-19), out.undo]);
        if (out.becameLeech) app.toast(out.card.suspended ? 'Leech: this card was suspended.' : 'Leech: this card keeps slipping. Consider rewriting it.');
        stopAudio();
        await show(cur.card.id);
      } catch (e) {
        app.toast((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [cur, busy, show, app],
  );

  const doUndo = useCallback(async () => {
    const last = undo[undo.length - 1];
    if (!last || busy) return;
    setBusy(true);
    try {
      const card = await undoAnswer(snap.current!, last);
      setUndo((u) => u.slice(0, -1));
      const note = await db.notes.get(card.noteId);
      const noteType = note && (await db.noteTypes.get(note.noteTypeId));
      const deck = await db.decks.get(card.deckId);
      if (note && noteType) {
        const ctx: RenderContext = { noteType, fields: note.fields, tags: note.tags, deckName: deck?.name ?? '', cardOrd: card.ord, flag: card.flag };
        const r = renderCard(ctx);
        setCounts(countsFor(snap.current!, deckId));
        setCur({ card, queue: card.state === CardState.New ? 'new' : card.state === CardState.Review ? 'review' : 'learn', ctx, question: r.question, css: r.css, shownAt: Date.now() });
        setStatus({ kind: 'card' });
      }
      app.toast('Undid the last answer.');
    } finally {
      setBusy(false);
    }
  }, [undo, busy, deckId, app]);

  // keyboard: space/enter reveal or Good, 1–4 grade, u undo, e edit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return;
      const inTypeBox = (e.composedPath()[0] as HTMLElement)?.id === 'typeans';
      if (inTypeBox && e.key !== 'Enter') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (cur?.answer === undefined) reveal();
        else grade(3);
      } else if (cur?.answer !== undefined && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as AnswerGrade);
      else if (e.key === 'u' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) doUndo();
      else if (e.key === 'e' && cur) app.go({ name: 'editNote', noteId: cur.card.noteId });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, reveal, grade, doUndo, sheet, app]);

  const act = async (fn: () => Promise<void>, msg: string) => {
    await fn();
    app.toast(msg);
    snap.current = await loadSnapshot();
    await show();
  };

  const stateLabel = cur ? (cur.queue === 'new' ? 'New' : cur.queue === 'learn' ? 'Learning' : 'Review') : '';

  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" aria-label="Close" onClick={() => { stopAudio(); app.back(); app.refresh(); }}>
          <IconClose />
        </button>
        <div className="study-counts" aria-label="Cards left today">
          <span className={cur?.queue === 'new' ? 'active' : ''} style={{ color: 'var(--c-new)' }} title="New">{counts.newCount}</span>
          <span className={cur?.queue === 'learn' ? 'active' : ''} style={{ color: 'var(--c-learn)' }} title="Learning">{counts.learnCount}</span>
          <span className={cur?.queue === 'review' ? 'active' : ''} style={{ color: 'var(--c-due)' }} title="To review">{counts.reviewCount}</span>
        </div>
        <button className="icon-btn" aria-label="Undo last answer" disabled={!undo.length || busy} onClick={doUndo}>
          <IconUndo />
        </button>
        <button className="icon-btn" aria-label="Card actions" disabled={!cur} onClick={() => setSheet('menu')}>
          <IconMore />
        </button>
      </div>

      <div className="study-body">
        {status.kind === 'card' && cur && (
          <article
            className={'index-card' + (cur.answer === undefined ? ' tappable' : '')}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest?.('button, a, input')) return;
              if (cur.answer === undefined && !typeBox.current) reveal();
            }}
          >
            {cur.card.flag > 0 && <span className="flag-strip" style={{ background: FLAG_COLORS[cur.card.flag] }} aria-label={`${FLAG_NAMES[cur.card.flag]} flag`} />}
            <div className="index-card-head">
              <span className="deck">{cur.ctx.deckName.split('::').join(' › ')}</span>
              <span className={`state ${cur.queue}`}>{stateLabel}</span>
            </div>
            <div className="index-card-content" key={cur.card.id + (cur.answer === undefined ? 'q' : 'a')}>
              <CardView
                html={cur.answer ?? cur.question}
                css={cur.css}
                autoplay
                onRendered={(root) => {
                  if (cur.answer !== undefined) {
                    root.getElementById('answer')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    return;
                  }
                  const box = root.getElementById('typeans') as HTMLInputElement | null;
                  typeBox.current = box;
                  if (box) {
                    box.addEventListener('keydown', (ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        reveal();
                      }
                    });
                  }
                }}
              />
            </div>
          </article>
        )}
        {status.kind === 'loading' && <p className="muted center" style={{ marginTop: '30vh' }}>Loading…</p>}
        {status.kind === 'error' && <p className="error center" style={{ marginTop: '30vh' }}>{status.message}</p>}
        {status.kind === 'waiting' && (
          <div className="finished">
            <h2>Almost there</h2>
            <p>
              A card you’re learning comes back at {new Date(status.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {status.until - Date.now() < 60 * MINUTE ? ` (in ${formatInterval(status.until - Date.now())})` : ''}. Stay here and it will appear, or come back later.
            </p>
            <button className="btn wide" onClick={() => app.back()}>
              Back to deck
            </button>
          </div>
        )}
        {status.kind === 'done' && (
          <div className="finished">
            <h2>That’s everything for today</h2>
            <p>You’ve finished “{deckName.current.split('::').pop()}”. New reviews will be ready tomorrow.</p>
            <button className="btn primary wide" onClick={() => { app.back(); app.refresh(); }}>
              Back to decks
            </button>
          </div>
        )}
      </div>

      {status.kind === 'card' && cur && (
        <div className="study-foot">
          {cur.answer === undefined ? (
            <button className="btn primary wide" onClick={reveal}>
              Show answer
            </button>
          ) : (
            <div className="grades reveal-in" role="group" aria-label="How well did you remember?">
              {GRADES.map((g) => (
                <button key={g} className={`grade ${GRADE_CLASS[g]}`} disabled={busy} onClick={() => grade(g)} aria-label={`${GRADE_NAMES[g]}, next in ${formatInterval(cur.previews![g - 1].delay)}`}>
                  <b>{GRADE_NAMES[g]}</b>
                  <small>{formatInterval(cur.previews![g - 1].delay)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sheet === 'menu' && cur && (
        <ActionSheet
          onClose={() => setSheet(null)}
          actions={[
            { label: 'Edit note', run: () => app.go({ name: 'editNote', noteId: cur.card.noteId }) },
            { label: 'Flag card', run: () => setSheet('flag') },
            { label: 'Bury card until tomorrow', run: () => act(() => buryCards([cur.card.id]), 'Card buried until tomorrow.') },
            {
              label: 'Bury note until tomorrow',
              run: async () => {
                const ids = (await db.cards.where('noteId').equals(cur.card.noteId).toArray()).map((c) => c.id);
                await act(() => buryCards(ids), 'Note buried until tomorrow.');
              },
            },
            { label: 'Suspend card', run: () => act(() => setSuspended([cur.card.id], true), 'Card suspended. Unsuspend it from Browse.') },
            { label: 'Delete note', danger: true, run: () => setSheet('delete') },
          ]}
        />
      )}
      {sheet === 'flag' && cur && (
        <ActionSheet
          title="Flag card"
          onClose={() => setSheet(null)}
          actions={FLAG_NAMES.map((name, i) => ({
            label: i === 0 ? 'No flag' : name,
            color: FLAG_COLORS[i],
            run: async () => {
              await setFlag([cur.card.id], i);
              setCur({ ...cur, card: { ...cur.card, flag: i } });
            },
          }))}
        />
      )}
      {sheet === 'delete' && cur && (
        <ConfirmSheet
          title="Delete this note?"
          body="The note and all of its cards will be deleted. This can’t be undone."
          confirm="Delete note"
          danger
          onClose={() => setSheet(null)}
          onConfirm={() => act(() => deleteNotes([cur.card.noteId]), 'Note deleted.')}
        />
      )}
    </div>
  );
}
