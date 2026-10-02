import { useState } from 'react';
import { useLoad } from '../app-state';
import { computeStats } from '../../data/stats';
import { listDecks } from '../../data/repo';
import { TitleBar, plural } from '../components/common';
import { BarChart } from '../components/BarChart';
import { formatDuration } from '../../domain/time';

const pct = (p: number, t: number) => (t ? `${Math.round((p / t) * 100)}%` : '–');

export function StatsScreen() {
  const [deckId, setDeckId] = useState<number | null>(null);
  const { data: decks } = useLoad(listDecks, []);
  const { data: s } = useLoad(() => computeStats(deckId, 30), [deckId]);

  const dayLabel = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="screen">
      <TitleBar large title="Statistics" />
      <label className="field">
        <span>Deck</span>
        <select value={deckId ?? ''} onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">All decks</option>
          {decks?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name.split('::').join(' › ')}
            </option>
          ))}
        </select>
      </label>
      {s && (
        <>
          <div className="tiles">
            <div className="tile">
              <b>{s.today.reviews.toLocaleString()}</b>
              <span>Answers today</span>
            </div>
            <div className="tile">
              <b>{s.today.reviews ? formatDuration(s.today.timeMs) : '0 min'}</b>
              <span>Time today</span>
            </div>
            <div className="tile">
              <b>{pct(s.today.correct, s.today.graded)}</b>
              <span>Correct today</span>
            </div>
          </div>

          <div className="chart-card">
            <h3>Coming up</h3>
            <p>
              {s.forecast[0].count ? `${plural(s.forecast[0].count, 'card')} due today, ` : 'Nothing due today, '}
              {plural(s.forecast.slice(1, 8).reduce((a, b) => a + b.count, 0), 'card')} over the next 7 days.
            </p>
            <BarChart
              ariaLabel="Cards due per day for the next 30 days"
              bars={s.forecast.map((f) => ({ label: f.day === 0 ? 'Today' : dayLabel(f.day), value: f.count, tip: `${f.day === 0 ? 'Today' : dayLabel(f.day)}: ${plural(f.count, 'card')}` }))}
            />
          </div>

          <div className="chart-card">
            <h3>Reviews, last 30 days</h3>
            <p>
              {plural(s.history.reduce((a, b) => a + b.count, 0), 'answer')} in {formatDuration(s.history.reduce((a, b) => a + b.timeMs, 0))}
              {s.streak > 1 ? `, studied ${s.streak} days in a row` : ''}.
            </p>
            <BarChart
              ariaLabel="Answers per day over the last 30 days"
              bars={s.history.map((h) => ({ label: h.day === 0 ? 'Today' : dayLabel(h.day), value: h.count, tip: `${h.day === 0 ? 'Today' : dayLabel(h.day)}: ${plural(h.count, 'answer')}` }))}
            />
          </div>

          <div className="chart-card">
            <h3>Retention, last 30 days</h3>
            <p>How often you remembered review cards. The target is set per deck in Options (90% by default).</p>
            <dl className="kv">
              <dt>Young cards (interval under 3 weeks)</dt>
              <dd>{pct(s.retention.young.pass, s.retention.young.total)} <span className="muted">of {s.retention.young.total}</span></dd>
              <dt>Mature cards</dt>
              <dd>{pct(s.retention.mature.pass, s.retention.mature.total)} <span className="muted">of {s.retention.mature.total}</span></dd>
            </dl>
          </div>

          <div className="chart-card">
            <h3>Cards</h3>
            <dl className="kv">
              <dt>New</dt>
              <dd>{s.counts.new.toLocaleString()}</dd>
              <dt>Learning</dt>
              <dd>{s.counts.learning.toLocaleString()}</dd>
              <dt>Young</dt>
              <dd>{s.counts.young.toLocaleString()}</dd>
              <dt>Mature</dt>
              <dd>{s.counts.mature.toLocaleString()}</dd>
              <dt>Suspended</dt>
              <dd>{s.counts.suspended.toLocaleString()}</dd>
              <dt>Total</dt>
              <dd>{s.counts.total.toLocaleString()}</dd>
            </dl>
          </div>
        </>
      )}
    </div>
  );
}
