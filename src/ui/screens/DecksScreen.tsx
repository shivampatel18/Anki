import { useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { buildTree, flattenTree, loadSnapshot, type DeckNode } from '../../data/queue';
import { todaySummary } from '../../data/stats';
import { db } from '../../data/db';
import { ensureDeck } from '../../data/repo';
import { Count, TitleBar, plural } from '../components/common';
import { IconChevron, IconImport, IconLock, IconPlus } from '../components/Icons';
import { PromptSheet } from '../components/Sheet';
import { formatDuration } from '../../domain/time';

export function DecksScreen() {
  const app = useApp();
  const [creating, setCreating] = useState(false);
  const { data } = useLoad(async () => {
    const snap = await loadSnapshot();
    const tree = buildTree(snap);
    const cards = await db.cards.count();
    const today = await todaySummary();
    return { tree, cards, today };
  }, []);

  const toggle = async (n: DeckNode) => {
    await db.decks.update(n.deck.id, { collapsed: !n.deck.collapsed });
    app.refresh();
  };

  // Hide the empty Default deck once other decks exist, like Anki does.
  const roots = data?.tree.filter((r) => !(r.deck.id === 1 && r.children.length === 0 && data.tree.length > 1 && r.newCount + r.learnCount + r.reviewCount === 0)) ?? [];
  const rows = flattenTree(roots, false);

  return (
    <div className="screen">
      <TitleBar
        large
        title="Decks"
        right={
          <>
            <button className="icon-btn" aria-label="Import a deck" onClick={() => app.go({ name: 'import' })}>
              <IconImport />
            </button>
            <button className="icon-btn" aria-label="New deck" onClick={() => setCreating(true)}>
              <IconPlus />
            </button>
          </>
        }
      />
      {data && data.today.reviews > 0 && (
        <p className="today-line">
          Studied {plural(data.today.reviews, 'card')} in {formatDuration(data.today.timeMs)} today.
        </p>
      )}
      {data && data.cards === 0 ? (
        <div className="empty">
          <h2>No cards yet</h2>
          <p>Bring over a deck from Anki on your computer, or write your first card here.</p>
          <div className="stack" style={{ maxWidth: 320, margin: '0 auto' }}>
            <button className="btn primary wide" onClick={() => app.go({ name: 'import' })}>
              Import an Anki deck
            </button>
            <button className="btn wide" onClick={() => app.tab('add')}>
              Add a card
            </button>
          </div>
        </div>
      ) : (
        data && (
          <>
            <div className="deck-head" aria-hidden="true">
              <span />
              <span>New</span>
              <span>Learn</span>
              <span>Due</span>
            </div>
            <div className="deck-list" role="list">
              {rows.map((n) => (
                <div key={n.deck.id} className={'deck-row' + (n.deck.notStarted ? ' not-started' : '')} role="listitem">
                  <div className="name" style={{ paddingLeft: n.depth * 16 }}>
                    {n.children.length ? (
                      <button className="caret" aria-expanded={!n.deck.collapsed} aria-label={n.deck.collapsed ? `Expand ${n.label}` : `Collapse ${n.label}`} onClick={() => toggle(n)}>
                        <IconChevron />
                      </button>
                    ) : (
                      <span className="caret-space" />
                    )}
                    <button className="open" onClick={() => app.go({ name: 'deck', deckId: n.deck.id })} aria-label={n.deck.notStarted ? `${n.label}, not started` : undefined}>
                      {n.deck.notStarted && <IconLock className="lock" />}
                      {n.label}
                    </button>
                  </div>
                  <Count n={n.newCount} kind="new" />
                  <Count n={n.learnCount} kind="learn" />
                  <Count n={n.reviewCount} kind="due" />
                </div>
              ))}
            </div>
          </>
        )
      )}
      {creating && (
        <PromptSheet
          title="New deck"
          label="Deck name"
          hint="Use :: to nest it, e.g. Languages::French"
          confirm="Create deck"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            await ensureDeck(name);
            app.refresh();
          }}
        />
      )}
    </div>
  );
}
