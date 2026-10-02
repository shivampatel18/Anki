import { useEffect, useState } from 'react';
import { AppProvider, useApp, type Tab } from './app-state';
import { ensureInitialized, getSettings } from '../data/repo';
import { applyTheme } from './theme';
import { DecksScreen } from './screens/DecksScreen';
import { DeckOverview } from './screens/DeckOverview';
import { StudyScreen } from './screens/StudyScreen';
import { NoteEditor } from './screens/NoteEditor';
import { BrowseScreen } from './screens/BrowseScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DeckOptions } from './screens/DeckOptions';
import { ImportScreen } from './screens/ImportScreen';
import { IconAdd, IconBrowse, IconDecks, IconSettings, IconStats } from './components/Icons';

export function App() {
  const [ready, setReady] = useState<'loading' | 'ok' | string>('loading');
  useEffect(() => {
    (async () => {
      await ensureInitialized();
      applyTheme((await getSettings()).theme);
      // ask the browser to keep our data (granted automatically for Home Screen apps on iOS)
      navigator.storage?.persist?.().catch(() => {});
      setReady('ok');
    })().catch((e) => setReady((e as Error).message || 'Storage is unavailable.'));
  }, []);
  if (ready === 'loading') return null;
  if (ready !== 'ok')
    return (
      <div className="screen">
        <h1>Recall can’t open its storage</h1>
        <p>{ready}</p>
        <p className="muted">Private Browsing blocks storage. Open Recall in a normal tab or from your Home Screen.</p>
      </div>
    );
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

const TABS: { tab: Tab; label: string; Icon: typeof IconDecks }[] = [
  { tab: 'decks', label: 'Decks', Icon: IconDecks },
  { tab: 'browse', label: 'Browse', Icon: IconBrowse },
  { tab: 'add', label: 'Add', Icon: IconAdd },
  { tab: 'stats', label: 'Stats', Icon: IconStats },
  { tab: 'settings', label: 'Settings', Icon: IconSettings },
];

function Shell() {
  const app = useApp();
  const r = app.route;
  let screen;
  let currentTab: Tab | null = null;
  switch (r.name) {
    case 'tab':
      currentTab = r.tab;
      screen =
        r.tab === 'decks' ? <DecksScreen /> :
        r.tab === 'browse' ? <BrowseScreen asTab /> :
        r.tab === 'add' ? <NoteEditor mode="add" asTab /> :
        r.tab === 'stats' ? <StatsScreen /> :
        <SettingsScreen />;
      break;
    case 'deck': screen = <DeckOverview deckId={r.deckId} />; currentTab = 'decks'; break;
    case 'study': screen = <StudyScreen deckId={r.deckId} />; break;
    case 'deckOptions': screen = <DeckOptions deckId={r.deckId} />; break;
    case 'editNote': screen = <NoteEditor mode="edit" noteId={r.noteId} />; break;
    case 'browse': screen = <BrowseScreen initialQuery={r.query} />; break;
    case 'add': screen = <NoteEditor mode="add" deckId={r.deckId} />; break;
    case 'import': screen = <ImportScreen />; break;
  }
  const showTabs = r.name === 'tab' || r.name === 'deck';
  return (
    <div className="shell">
      {screen}
      {showTabs && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map(({ tab, label, Icon }) => (
            <button key={tab} aria-current={currentTab === tab ? 'page' : undefined} onClick={() => app.tab(tab)}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>
      )}
      {app.currentToast && (
        <div className="toast" role="status" key={app.currentToast.id} style={showTabs ? undefined : { bottom: 'calc(var(--safe-bottom) + 96px)' }}>
          {app.currentToast.text}
          {app.currentToast.action && <button onClick={app.currentToast.action.run}>{app.currentToast.action.label}</button>}
        </div>
      )}
    </div>
  );
}
