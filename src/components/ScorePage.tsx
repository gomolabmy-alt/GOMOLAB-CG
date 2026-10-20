import { useState } from 'react';
import { Settings, X, Play, Pause, RotateCcw } from 'lucide-react';
import { useVmixStore, formatTime } from '../stores/vmixStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useTeamDbStore } from '../stores/teamDbStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { normalizeGroups, normalizePots, resolveGroupSlots } from './TournamentManager';
import { SCORE_INCREMENTS } from '../types/vmix';
import type { Scoreboard, VmixTimer, ScoreboardStyle, TimerMode, TimerFormat } from '../types/vmix';

// ─── Scoreboard Card ────────────────────────────────────────────────────────

function ScoreboardCard({ sb }: { sb: Scoreboard }) {
  const { scoreAction, resetScore, updateScoreboard, deleteScoreboard, vmixState } = useVmixStore();
  const [editing, setEditing] = useState(false);
  const increments = SCORE_INCREMENTS[sb.style];

  const inputOptions = vmixState?.inputs.filter((i) => i.type === 'GT') ?? [];

  return (
    <div className="score-card">
      <div className="score-card-header">
        <span className="score-card-name">{sb.name}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn--ghost btn--small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : <Settings size={14} />}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => deleteScoreboard(sb.id)} title="Delete"><X size={14} /></button>
        </div>
      </div>

      {editing ? (
        <div className="score-settings">
          <div className="field-row">
            <label className="field-label">Name</label>
            <input className="field-input" value={sb.name}
              onChange={(e) => updateScoreboard(sb.id, { name: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">Style</label>
            <select className="field-input" value={sb.style}
              onChange={(e) => updateScoreboard(sb.id, { style: e.target.value as ScoreboardStyle })}>
              <option value="basic">Basic</option>
              <option value="basketball">Basketball</option>
              <option value="football">American Football</option>
              <option value="soccer">Soccer</option>
            </select>
          </div>
          <div className="score-team-settings">
            <div className="field-row">
              <label className="field-label">Team A Name</label>
              <input className="field-input" value={sb.teamA.name}
                onChange={(e) => updateScoreboard(sb.id, { teamA: { ...sb.teamA, name: e.target.value } })} />
            </div>
            <div className="field-row">
              <label className="field-label">Team B Name</label>
              <input className="field-input" value={sb.teamB.name}
                onChange={(e) => updateScoreboard(sb.id, { teamB: { ...sb.teamB, name: e.target.value } })} />
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">vMix Title Input</label>
            <select className="field-input" value={sb.vmixInputKey}
              onChange={(e) => updateScoreboard(sb.id, { vmixInputKey: e.target.value })}>
              <option value="">— none (local only) —</option>
              {inputOptions.map((i) => (
                <option key={i.key} value={i.key}>{i.number}. {i.title}</option>
              ))}
            </select>
          </div>
          {sb.vmixInputKey && (
            <div className="score-field-map">
              {[
                { label: 'Score A field', key: 'fieldScoreA', val: sb.fieldScoreA },
                { label: 'Score B field', key: 'fieldScoreB', val: sb.fieldScoreB },
                { label: 'Team A field',  key: 'fieldTeamA',  val: sb.fieldTeamA },
                { label: 'Team B field',  key: 'fieldTeamB',  val: sb.fieldTeamB },
              ].map(({ label, key, val }) => (
                <div className="field-row" key={key}>
                  <label className="field-label">{label}</label>
                  <input className="field-input" value={val}
                    placeholder="FieldName.Text"
                    onChange={(e) => updateScoreboard(sb.id, { [key]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="score-display">
          <div className="score-team score-team--a">
            <div className="score-team-name" style={{ color: sb.teamA.color }}>{sb.teamA.name}</div>
            <div className="score-number">{sb.teamA.score}</div>
            <div className="score-btns">
              {increments.map((n) => (
                <button key={n} className="score-inc-btn" onClick={() => scoreAction(sb.id, 'A', n)}>+{n}</button>
              ))}
              <button className="score-dec-btn" onClick={() => scoreAction(sb.id, 'A', -1)}>–1</button>
            </div>
          </div>

          <div className="score-divider">
            <span className="score-colon">:</span>
            <button className="btn btn--ghost btn--small" onClick={() => resetScore(sb.id)} title="Reset scores">
              RST
            </button>
          </div>

          <div className="score-team score-team--b">
            <div className="score-team-name" style={{ color: sb.teamB.color }}>{sb.teamB.name}</div>
            <div className="score-number">{sb.teamB.score}</div>
            <div className="score-btns">
              {increments.map((n) => (
                <button key={n} className="score-inc-btn" onClick={() => scoreAction(sb.id, 'B', n)}>+{n}</button>
              ))}
              <button className="score-dec-btn" onClick={() => scoreAction(sb.id, 'B', -1)}>–1</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Timer Card ─────────────────────────────────────────────────────────────

function TimerCard({ timer }: { timer: VmixTimer }) {
  const { startTimer, pauseTimer, resetTimer, adjustTimer, updateTimer, deleteTimer, vmixState } = useVmixStore();
  const [editing, setEditing] = useState(false);
  const inputOptions = vmixState?.inputs.filter((i) => i.type === 'GT') ?? [];

  const display = formatTime(timer.currentMs, timer.format);
  const totalSec = timer.durationMs / 1000;

  return (
    <div className="timer-card">
      <div className="score-card-header">
        <span className="score-card-name">{timer.name}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn--ghost btn--small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : <Settings size={14} />}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => deleteTimer(timer.id)} title="Delete"><X size={14} /></button>
        </div>
      </div>

      {editing ? (
        <div className="score-settings">
          <div className="field-row">
            <label className="field-label">Name</label>
            <input className="field-input" value={timer.name}
              onChange={(e) => updateTimer(timer.id, { name: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">Mode</label>
            <select className="field-input" value={timer.mode}
              onChange={(e) => {
                const mode = e.target.value as TimerMode;
                updateTimer(timer.id, { mode, currentMs: mode === 'countdown' ? timer.durationMs : 0 });
              }}>
              <option value="countdown">Countdown</option>
              <option value="countup">Count Up</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Display Format</label>
            <select className="field-input" value={timer.format}
              onChange={(e) => updateTimer(timer.id, { format: e.target.value as TimerFormat })}>
              <option value="hh:mm:ss">hh:mm:ss</option>
              <option value="h:mm:ss">h:mm:ss</option>
              <option value="mm:ss">mm:ss</option>
              <option value="ss">seconds only</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Duration (seconds)</label>
            <input className="field-input" type="number" value={totalSec} min={0}
              onChange={(e) => {
                const ms = Number(e.target.value) * 1000;
                updateTimer(timer.id, { durationMs: ms, currentMs: timer.mode === 'countdown' ? ms : 0 });
              }} />
          </div>
          <div className="field-row">
            <label className="field-label">High Precision (100ms)</label>
            <input type="checkbox" checked={timer.highPrecision}
              onChange={(e) => updateTimer(timer.id, { highPrecision: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label">vMix Title Input</label>
            <select className="field-input" value={timer.vmixInputKey}
              onChange={(e) => updateTimer(timer.id, { vmixInputKey: e.target.value })}>
              <option value="">— none (local only) —</option>
              {inputOptions.map((i) => (
                <option key={i.key} value={i.key}>{i.number}. {i.title}</option>
              ))}
            </select>
          </div>
          {timer.vmixInputKey && (
            <div className="field-row">
              <label className="field-label">Field Name</label>
              <input className="field-input" value={timer.fieldName} placeholder="Timer.Text"
                onChange={(e) => updateTimer(timer.id, { fieldName: e.target.value })} />
            </div>
          )}
        </div>
      ) : (
        <div className="timer-display">
          <div className="timer-time">{display}</div>
          <div className="timer-bar-wrap">
            {timer.durationMs > 0 && (
              <div className="timer-bar">
                <div
                  className="timer-bar-fill"
                  style={{
                    width: `${Math.min(100, (timer.currentMs / timer.durationMs) * 100)}%`,
                    background: timer.mode === 'countdown'
                      ? timer.currentMs < timer.durationMs * 0.2 ? 'var(--red)' : 'var(--accent)'
                      : 'var(--green-bright)',
                  }}
                />
              </div>
            )}
          </div>
          <div className="timer-controls">
            <div className="timer-adjust">
              <button className="timer-adj-btn" onClick={() => adjustTimer(timer.id, -60000)}>–1m</button>
              <button className="timer-adj-btn" onClick={() => adjustTimer(timer.id, -10000)}>–10s</button>
              <button className="timer-adj-btn" onClick={() => adjustTimer(timer.id, 10000)}>+10s</button>
              <button className="timer-adj-btn" onClick={() => adjustTimer(timer.id, 60000)}>+1m</button>
            </div>
            <div className="timer-main-controls">
              {timer.running ? (
                <button className="timer-btn timer-btn--pause" onClick={() => pauseTimer(timer.id)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pause size={14} /> Pause</span>
                </button>
              ) : (
                <button className="timer-btn timer-btn--start" onClick={() => startTimer(timer.id)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Play size={14} /> Start</span>
                </button>
              )}
              <button className="timer-btn timer-btn--reset" onClick={() => resetTimer(timer.id)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><RotateCcw size={14} /> Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Draw / Group & Pool Stage ──────────────────────────────────────────────
// Read-only reference for an operator mid-match: "who's in which group/pot"
// from the Draw, without leaving the Score tab to open the separate
// Tournament Database window. Reuses the exact same helpers/data the Draw
// tab itself (TournamentManager.tsx's DrawPanel) is built on — this never
// writes anything back, just reads the same `Tournament.groups`/`pots` and
// `SavedTeam.group`/`pot`/`groupPosition` fields.

function DrawStageSection() {
  const { tournaments } = useTournamentStore();
  const { teams: allTeams } = useTeamDbStore();
  const { canvasTournamentId } = useAppSettings();
  // Defaults to whatever tournament the Sidebar's own venue-scope picker is
  // already set to (the one global "which tournament" concept this app
  // has) — overridable here so Scoring isn't stuck if that's unset/wrong.
  const [tournamentIdOverride, setTournamentIdOverride] = useState('');
  const [category, setCategory] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const tournamentId = tournamentIdOverride || canvasTournamentId || tournaments[0]?.id || '';
  const tournament = tournaments.find(t => t.id === tournamentId);
  const categories = tournament?.categories ?? [];
  const inScope = (teamCategory?: string) => !category || !teamCategory || teamCategory === category;

  const groups = normalizeGroups(tournament?.groups).filter(g => inScope(g.category));
  const pots = normalizePots(tournament?.pots).filter(p => inScope(p.category));
  const tournamentTeams = allTeams.filter(t => t.tournamentId === tournamentId && inScope(t.category));

  return (
    <div className="score-page-section">
      <div className="score-page-row">
        <div className="mix-section-title">Draw — Groups &amp; Pots</div>
        <button className="btn btn--ghost btn--small" onClick={() => setCollapsed(v => !v)}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="score-page-row" style={{ gap: 8 }}>
            <select className="field-input" style={{ maxWidth: 220 }} value={tournamentId}
              onChange={(e) => setTournamentIdOverride(e.target.value)}>
              {tournaments.length === 0 && <option value="">— no tournaments —</option>}
              {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {categories.length > 0 && (
              <select className="field-input" style={{ maxWidth: 160 }} value={category}
                onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>

          {!tournament ? (
            <p className="app-settings-hint">Select a tournament to see its draw.</p>
          ) : groups.length === 0 && pots.length === 0 ? (
            <p className="app-settings-hint">No groups or pots set up for this tournament yet — configure them in the Draw tab of the Tournament Database.</p>
          ) : (
            <div className="score-draw-grid">
              {groups.map(g => {
                const members = tournamentTeams.filter(t => t.group === g.name);
                const { slots } = resolveGroupSlots(members, g.capacity);
                const rows = slots.length > 0 ? slots : members.map(m => m);
                return (
                  <div key={g.name} className="score-draw-card">
                    <div className="score-draw-card-title">{g.name}</div>
                    {rows.length === 0 ? (
                      <div className="score-draw-empty">No teams yet</div>
                    ) : (
                      <ol className="score-draw-list">
                        {rows.map((t, i) => (
                          <li key={t?.id ?? i} className={t ? undefined : 'score-draw-list-empty'}>
                            {t ? (t.shortName || t.name) : '—'}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
              {pots.map(p => {
                const members = tournamentTeams.filter(t => t.pot === p.name);
                return (
                  <div key={p.name} className="score-draw-card">
                    <div className="score-draw-card-title">{p.name}</div>
                    {members.length === 0 ? (
                      <div className="score-draw-empty">No teams yet</div>
                    ) : (
                      <ul className="score-draw-list">
                        {members.map(t => (
                          <li key={t.id} className={t.group ? 'score-draw-list-drawn' : undefined} title={t.group ? `Drawn into ${t.group}` : 'Not drawn yet'}>
                            {t.shortName || t.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Score Page ──────────────────────────────────────────────────────────────

export function ScorePage() {
  const { scoreboards, timers, addScoreboard, addTimer } = useVmixStore();
  return (
    <div className="score-page page-scroll">
      <div className="score-page-section">
        <div className="score-page-row">
          <div className="mix-section-title">Scoreboards</div>
          <button className="btn btn--ghost btn--small" onClick={addScoreboard}>+ Add</button>
        </div>
        {scoreboards.map((sb) => <ScoreboardCard key={sb.id} sb={sb} />)}
      </div>

      <div className="score-page-section">
        <div className="score-page-row">
          <div className="mix-section-title">Timers</div>
          <button className="btn btn--ghost btn--small" onClick={addTimer}>+ Add</button>
        </div>
        {timers.map((t) => <TimerCard key={t.id} timer={t} />)}
      </div>

      <DrawStageSection />
    </div>
  );
}
