import { useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { buildTree, findNode, loadSnapshot } from '../../data/queue';
import { db } from '../../data/db';
import { DEFAULT_DECK_ID, deckAndChildrenIds, deleteDeck, renameDeck } from '../../data/repo';
import { TitleBar, plural } from '../components/common';
import { ActionSheet, ConfirmSheet, PromptSheet } from '../components/Sheet';
import { IconMore } from '../components/Icons';
import { CardState } from '../../domain/types';

export function DeckOverview({ deckId }: { deckId: number }) {
  const app = useApp();
  const [sheet, setSheet] = useState<'menu' | 'rename' | 'delete' | null>(null);
  const { data } = useLoad(async () => {
    const deck = await db.decks.get(deckId);
    if (!deck) return null;
    const snap = await loadSnapshot();
    const node = findNode(buildTree(snap), deckId);
    const ids = await deckAndChildrenIds(deckId);
    const cards = await db.cards.where('deckId').anyOf(ids).toArray();
    const total = cards.length;
    const newTotal = cards.filter((c) => c.state === CardState.New && !c.suspended).length;
    const nextDue = cards.filter((c) => c.state !== CardState.New && !c.suspended && c.due > snap.todayEnd).reduce((m, c) => Math.min(m, c.due), Infinity);
    return { deck, node, total, newTotal, nextDue };
  }, [deckId]);

  if (data === null) {
    return (
      <div className="screen no-tabs">
        <TitleBar title="Deck" />
        <p className="muted">This deck no longer exists.</p>
      </div>
    );
  }
  if (!data) return <div className="screen no-tabs" />;
  const { deck, node } = data;
  const due = (node?.newCount ?? 0) + (node?.learnCount ?? 0) + (node?.reviewCount ?? 0);

  return (
    <div className="screen">
      <TitleBar
        title={deck.name.split('::').pop()!}
        right={
          <button className="icon-btn" aria-label="Deck actions" onClick={() => setSheet('menu')}>
            <IconMore />
          </button>
        }
      />
      {deck.name.includes('::') && <p className="muted center" style={{ marginTop: -6 }}>{deck.name.split('::').slice(0, -1).join(' › ')}</p>}
      <div className="overview-counts">
        <div>
          <b style={{ color: 'var(--c-new)' }}>{node?.newCount ?? 0}</b>
          <span>New</span>
        </div>
        <div>
          <b style={{ color: 'var(--c-learn)' }}>{node?.learnCount ?? 0}</b>
          <span>Learning</span>
        </div>
        <div>
          <b style={{ color: 'var(--c-due)' }}>{node?.reviewCount ?? 0}</b>
          <span>To review</span>
        </div>
      </div>
      {due > 0 ? (
        <button className="btn primary wide" style={{ minHeight: 56, fontSize: 18 }} onClick={() => app.go({ name: 'study', deckId })}>
          Study now
        </button>
      ) : (
        <div className="group" style={{ padding: 16 }}>
          <b>You’re done with this deck for today.</b>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {data.total === 0
              ? 'It has no cards yet.'
              : Number.isFinite(data.nextDue)
                ? `Next review: ${new Date(data.nextDue).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.`
                : data.newTotal > 0
                  ? `${plural(data.newTotal, 'new card')} waiting; the daily limit is reached.`
                  : 'Nothing is scheduled.'}
          </p>
        </div>
      )}
      <p className="muted center" style={{ marginTop: 14 }}>
        {plural(data.total, 'card')} in this deck{deck.name.includes('::') || node?.children.length ? ' and its subdecks' : ''}.
      </p>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => app.go({ name: 'add', deckId })}>
          Add cards
        </button>
        <button className="btn" onClick={() => app.go({ name: 'browse', query: `deck:"${deck.name}"` })}>
          Browse
        </button>
        <button className="btn" onClick={() => app.go({ name: 'deckOptions', deckId })}>
          Options
        </button>
      </div>

      {sheet === 'menu' && (
        <ActionSheet
          title={deck.name}
          onClose={() => setSheet(null)}
          actions={[
            { label: 'Rename deck', run: () => setSheet('rename') },
            { label: 'Deck options', run: () => app.go({ name: 'deckOptions', deckId }) },
            { label: 'Delete deck', danger: true, hidden: deckId === DEFAULT_DECK_ID, run: () => setSheet('delete') },
          ]}
        />
      )}
      {sheet === 'rename' && (
        <PromptSheet
          title="Rename deck"
          label="Deck name"
          initial={deck.name}
          hint="Use :: to move it under another deck."
          confirm="Rename"
          onClose={() => setSheet(null)}
          onSubmit={async (v) => {
            await renameDeck(deckId, v);
            app.refresh();
          }}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title={`Delete “${deck.name}”?`}
          body={`This deletes the deck, its subdecks and ${plural(data.total, 'card')}. It can’t be undone.`}
          confirm="Delete deck"
          danger
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            const n = await deleteDeck(deckId);
            app.toast(`Deleted ${plural(n, 'card')}.`);
            app.back();
            app.refresh();
          }}
        />
      )}
    </div>
  );
}
