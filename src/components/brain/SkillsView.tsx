import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SKILL_GRAPH, skillEdges, skillUsage, selectSkills, isSkillOff, setSkillOff,
  SKILLS_EVENT, learnedSkills, matchLearned, forgetSkill,
  type SkillDef, type SkillArea, type LearnedSkill,
} from '../../lib/skillGraph';
import { SKILLS_REGISTRY, isSkillInstalled, getActiveSkillIds } from '../../lib/skills';

// ─── The Skills graph ─────────────────────────────────────────────────────────
//
// The Brain's second half. The first shows what the user KNOWS; this shows what their agents can
// DO, and — more usefully — how those capabilities depend on each other, because that dependency is
// what decides how many tokens a request costs.
//
// The old arrangement had no way to see any of this. Skills were a flat list in a panel, every
// active one was pasted into every request, and there was nothing anywhere that said the browser is
// what makes outreach possible. Drawing the edges makes the selection rule legible: a request
// lights up the skills it matched, plus the ones those need, and only those are sent.

const AREA_COLOR: Record<SkillArea, string> = {
  web:       '#38BDF8',
  leads:     '#34D399',
  make:      '#F472B6',
  knowledge: '#7C5CFF',
  work:      '#FBBF24',
  apps:      '#A78BFA',
  code:      '#F87171',
};
const AREA_LABEL: Record<SkillArea, string> = {
  web: 'Web', leads: 'Leads & outreach', make: 'Making things',
  knowledge: 'Memory', work: 'Getting work done', apps: 'Connected apps', code: 'Code',
};

const NODE_W = 158, NODE_H = 44;

/**
 * Lay the graph out by AREA — a column per area, skills stacked inside it.
 *
 * Deliberately deterministic rather than a force simulation: the same skills land in the same
 * places every time the screen is opened, so the picture becomes something you can learn instead of
 * a fresh tangle on each visit.
 */
function layout(): Record<string, { x: number; y: number }> {
  const areas = [...new Set(SKILL_GRAPH.map((s) => s.area))];
  const pos: Record<string, { x: number; y: number }> = {};
  areas.forEach((area, ai) => {
    SKILL_GRAPH.filter((s) => s.area === area).forEach((s, si) => {
      pos[s.id] = { x: 40 + ai * (NODE_W + 58), y: 60 + si * (NODE_H + 34) };
    });
  });
  return pos;
}

export default function SkillsView() {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLearned, setSelectedLearned] = useState<string | null>(null);
  const [probe, setProbe] = useState('');
  const [tick, setTick] = useState(0);          // re-read localStorage after a toggle
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(SKILLS_EVENT, on);
    return () => window.removeEventListener(SKILLS_EVENT, on);
  }, []);

  const pos = useMemo(layout, []);
  const edges = useMemo(skillEdges, []);
  const usage = useMemo(skillUsage, [tick]);
  const off = useMemo(() => new Set(SKILL_GRAPH.filter((s) => isSkillOff(s.id)).map((s) => s.id)), [tick]);

  // The installed skills.sh files, shown alongside the built-in capabilities — they are skills the
  // agents hold too, and until now there was nowhere that showed both together.
  const installed = useMemo(() => {
    const active = getActiveSkillIds();
    return SKILLS_REGISTRY.filter((s) => isSkillInstalled(s.id)).map((s) => ({ ...s, active: active.has(s.id) }));
  }, [tick]);

  // TRY IT. Type what you'd ask Krew and see exactly which skills that request would attach —
  // the matched ones and the ones dragged in behind them. This is the whole argument for the graph
  // made checkable: you can see for yourself that asking about a lead list does not send the
  // Postgres guide. `selectSkills` is the same function the chat calls, not a description of it.
  const picked = useMemo(() => {
    if (!probe.trim()) return null;
    // record: false — a preview must not count itself as use, or the usage figures shown two
    // inches away become a tally of what the user typed while reading them.
    return selectSkills(probe, undefined, 6, false);
  }, [probe, tick]);
  const pickedIds = useMemo(() => new Set((picked ?? []).map((p) => p.skill.id)), [picked]);

  const sel = SKILL_GRAPH.find((s) => s.id === selected) ?? null;
  const totalUses = Object.values(usage).reduce((a, b) => a + b.count, 0);

  // Skills the app worked out for itself. Re-read on every SKILLS_EVENT, so one appears here the
  // moment a task finishes rather than after a restart.
  const learned = useMemo(() => learnedSkills(), [tick]);
  const areaCount = useMemo(() => new Set(SKILL_GRAPH.map((s) => s.area)).size, []);
  const probeLearnedIds = useMemo(
    () => new Set(probe.trim() ? matchLearned(probe, 3).map((s) => s.id) : []),
    [probe, tick],
  );
  const selLearned = learned.find((s) => s.id === selectedLearned) ?? null;

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.min(2, Math.max(0.35, view.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView((v) => ({ scale: ns, x: mx - ((mx - v.x) / v.scale) * ns, y: my - ((my - v.y) / v.scale) * ns }));
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Probe bar */}
        <div className="px-5 py-2.5 flex items-center gap-3 shrink-0" style={{ borderBottom: '1px solid var(--nv-border)' }}>
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            placeholder="Type a request — see which skills it would use…"
            className="flex-1 max-w-xl rounded-lg px-3 py-1.5 text-[11px] outline-none"
            style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' }} />
          {picked && (
            <p className="text-[10.5px]" style={{ color: 'var(--nv-muted)' }}>
              {picked.length === 0
                ? <>No skill matches — nothing extra would be sent.</>
                : <>Would attach <b style={{ color: '#7C5CFF' }}>{picked.length}</b> of {SKILL_GRAPH.length}: {picked.map((p) => p.skill.name).join(', ')}</>}
            </p>
          )}
          {!picked && (
            <p className="text-[10.5px]" style={{ color: 'var(--nv-faint)' }}>
              {SKILL_GRAPH.length} skills · {edges.length} connections{totalUses ? ` · used ${totalUses} time${totalUses === 1 ? '' : 's'}` : ''}
            </p>
          )}
        </div>

        {/* Graph */}
        <div
          ref={wrapRef}
          className="relative flex-1 min-h-0 overflow-hidden"
          style={{ touchAction: 'none' }}
          onWheel={onWheel}
          onPointerDown={(e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          <div className="absolute inset-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            <svg className="absolute" style={{ overflow: 'visible', pointerEvents: 'none', left: 0, top: 0 }} width="1" height="1">
              {edges.map((e, i) => {
                const a = pos[e.source], b = pos[e.target];
                if (!a || !b) return null;
                const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H / 2;
                const x2 = b.x + NODE_W / 2, y2 = b.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                // An edge is "live" when the current probe pulled BOTH ends in — that is the hop
                // that made the prerequisite come along, drawn.
                const live = pickedIds.has(e.source) && pickedIds.has(e.target);
                const near = !selected || selected === e.source || selected === e.target;
                const src = SKILL_GRAPH.find((s) => s.id === e.source);
                return (
                  <g key={i} opacity={live ? 1 : near ? 0.5 : 0.1}>
                    <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={live ? '#7C5CFF' : src ? AREA_COLOR[src.area] : '#888'}
                      strokeWidth={live ? 2.2 : 1.4}
                      strokeDasharray={e.label === 'shares tools' ? '4 5' : undefined}
                      strokeLinecap="round" />
                  </g>
                );
              })}
            </svg>

            {SKILL_GRAPH.map((s) => {
              const p = pos[s.id];
              const isOff = off.has(s.id);
              const lit = pickedIds.has(s.id);
              const use = usage[s.id]?.count ?? 0;
              const dim = (picked && !lit) || (selected && selected !== s.id && !edges.some((e) =>
                (e.source === selected && e.target === s.id) || (e.target === selected && e.source === s.id)));
              return (
                <button
                  key={s.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected(s.id === selected ? null : s.id)}
                  className="absolute text-left rounded-xl px-2.5 py-2 transition-fast"
                  style={{
                    left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H,
                    background: 'var(--nv-surface)',
                    border: `1.5px solid ${lit ? '#7C5CFF' : selected === s.id ? AREA_COLOR[s.area] : 'var(--nv-border)'}`,
                    boxShadow: lit ? '0 0 0 3px rgba(124,92,255,.22), 0 6px 20px rgba(124,92,255,.35)'
                              : selected === s.id ? `0 6px 22px ${AREA_COLOR[s.area]}44` : '0 2px 8px rgba(0,0,0,.16)',
                    opacity: isOff ? 0.35 : dim ? 0.3 : 1,
                  }}
                  title={s.blurb}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AREA_COLOR[s.area] }} />
                    <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--nv-text)' }}>{s.name}</span>
                  </span>
                  <span className="block text-[9px] mt-0.5 pl-3.5" style={{ color: 'var(--nv-faint)' }}>
                    {isOff ? 'switched off' : s.tools.length ? `${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}` : 'built in'}
                    {use > 0 && ` · used ${use}×`}
                  </span>
                </button>
              );
            })}

            {/* ── What the app taught ITSELF ──────────────────────────────────────────────────
                Its own column, to the right of the built-ins, because these are a different kind
                of thing: nobody wrote them, they were picked up from work that actually happened
                here. Showing them in the same picture is the point — the user can see the app
                getting better at their particular job, and delete anything it got wrong. */}
            {learned.map((s, i) => {
              const p = { x: 40 + areaCount * (NODE_W + 58), y: 60 + i * (NODE_H + 34) };
              const lit = probeLearnedIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelectedLearned(s.id === selectedLearned ? null : s.id)}
                  className="absolute text-left rounded-xl px-2.5 py-2 transition-fast"
                  style={{
                    left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H,
                    background: 'var(--nv-surface)',
                    border: `1.5px dashed ${lit ? '#7C5CFF' : selectedLearned === s.id ? '#34D399' : 'var(--nv-border)'}`,
                    boxShadow: lit ? '0 0 0 3px rgba(124,92,255,.22), 0 6px 20px rgba(124,92,255,.35)' : '0 2px 8px rgba(0,0,0,.16)',
                    opacity: picked && !lit ? 0.3 : 1,
                  }}
                  title={s.guide}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#34D399' }} />
                    <span className="text-[11px] font-semibold leading-tight line-clamp-2" style={{ color: 'var(--nv-text)' }}>{s.name}</span>
                  </span>
                  <span className="block text-[9px] mt-0.5 pl-3.5" style={{ color: 'var(--nv-faint)' }}>
                    learned {s.kind === 'rule' ? '· rule' : ''}{s.uses > 0 ? ` · used ${s.uses}×` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="absolute left-4 bottom-4 flex items-center gap-3 text-[10px] px-2.5 py-1 rounded-lg pointer-events-none"
            style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-faint)' }}>
            <span>solid line = needs it</span><span>dashed = shares tools</span><span>drag to pan · scroll to zoom</span>
          </div>
          <div className="absolute right-4 top-3 flex flex-wrap gap-1.5 justify-end max-w-[18rem] pointer-events-none">
            {([...new Set(SKILL_GRAPH.map((s) => s.area))]).map((a) => (
              <span key={a} className="flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded-md"
                style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: AREA_COLOR[a] }} />{AREA_LABEL[a]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      <div className="w-80 shrink-0 flex flex-col overflow-y-auto" style={{ borderLeft: '1px solid var(--nv-border)', background: 'var(--nv-surface)' }}>
        {selLearned ? (
          <LearnedDetail skill={selLearned} onForget={() => { forgetSkill(selLearned.id); setSelectedLearned(null); setTick((t) => t + 1); }} />
        ) : sel ? (
          <SkillDetail skill={sel} usage={usage[sel.id]} off={off.has(sel.id)} onToggle={() => setSkillOff(sel.id, !off.has(sel.id))} />
        ) : (
          <div className="p-4">
            <h3 className="text-[13px] font-bold mb-1.5" style={{ color: 'var(--nv-text)' }}>What your agents can do</h3>
            <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--nv-muted)' }}>
              Every capability in the app, and what each one depends on. Skills are not sent to the AI all at
              once — a request pulls in the ones it matches plus whatever those need to work, and nothing else.
              That is what the lines are: the reason the browser comes along with outreach.
            </p>
            <p className="text-[11px] leading-relaxed mb-4" style={{ color: 'var(--nv-muted)' }}>
              Type a request in the box above to see exactly which ones it would attach. Click a skill for what
              it does and which tools sit behind it.
            </p>

            <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--nv-faint)' }}>Learned by itself</h4>
            {learned.length === 0 ? (
              <p className="text-[10.5px] leading-relaxed mb-4" style={{ color: 'var(--nv-faint)' }}>
                Nothing yet. When a task takes several steps to get right, the route that worked is written down
                here — and followed next time instead of being worked out again, which is fewer tokens and a
                faster answer. Saying “always do X” records a rule the same way.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 mb-4">
                {learned.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setSelectedLearned(s.id)} className="text-left text-[10.5px] leading-snug hover:underline" style={{ color: 'var(--nv-muted)' }}>
                      <b style={{ color: 'var(--nv-text)' }}>{s.name}</b>
                      {s.uses > 0 ? ` — reused ${s.uses}×` : ' — not needed again yet'}
                    </button>
                  </li>
                ))}
                {learned.length > 8 && (
                  <li className="text-[10px]" style={{ color: 'var(--nv-faint)' }}>+{learned.length - 8} more in the graph</li>
                )}
              </ul>
            )}

            <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--nv-faint)' }}>Installed skill files</h4>
            {installed.length === 0 ? (
              <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--nv-faint)' }}>
                None yet. Krew offers one when a task calls for it — they are guides from Anthropic, Vercel,
                Supabase and others, and they now attach only to requests they are relevant to.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {installed.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[10.5px]" style={{ color: 'var(--nv-muted)' }}>
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: s.active ? '#34D399' : 'var(--nv-border)' }} />
                    <span><b style={{ color: 'var(--nv-text)' }}>{s.name}</b> — {s.author}{s.active ? '' : ' (off)'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A skill nobody wrote: what it is, what triggers it, and a way to delete it if it is wrong. */
function LearnedDetail({ skill, onForget }: { skill: LearnedSkill; onForget: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="p-4">
      <div className="flex items-start gap-2 mb-1">
        <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: '#34D399' }} />
        <h3 className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--nv-text)' }}>{skill.name}</h3>
      </div>
      <p className="text-[10px] uppercase tracking-wide mb-2.5 pl-[18px]" style={{ color: 'var(--nv-faint)' }}>
        {skill.kind === 'rule' ? 'A rule you gave' : 'Worked out from a task that succeeded'}
      </p>

      <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>What it tells the agent</h4>
      <p className="text-[11px] leading-relaxed mb-3 px-2.5 py-2 rounded-lg"
        style={{ color: 'var(--nv-text)', background: 'var(--nv-bg)', border: '1px solid var(--nv-border)' }}>{skill.guide}</p>

      <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>Recognised by</h4>
      <div className="flex flex-wrap gap-1 mb-3">
        {skill.triggerWords.slice(0, 14).map((w) => (
          <span key={w} className="text-[9.5px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>{w}</span>
        ))}
      </div>

      <p className="text-[10.5px] mb-3" style={{ color: 'var(--nv-faint)' }}>
        Learned {new Date(skill.createdAt).toLocaleDateString()} ·{' '}
        {skill.uses ? `reused ${skill.uses} time${skill.uses === 1 ? '' : 's'}` : 'not needed again yet'}
      </p>

      {confirm ? (
        <div className="flex gap-1.5">
          <button onClick={onForget} className="flex-1 text-[11px] px-3 py-1.5 rounded-lg font-medium" style={{ background: '#DC2626', color: '#fff' }}>Forget it</button>
          <button onClick={() => setConfirm(false)} className="flex-1 text-[11px] px-3 py-1.5 rounded-lg" style={{ background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>Keep</button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="w-full text-[11px] px-3 py-1.5 rounded-lg" style={{ background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>
          Forget this skill
        </button>
      )}
      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--nv-faint)' }}>
        If a recipe is wrong or out of date, forget it — the agent goes back to working it out fresh. It is a
        hint, never an override: when it does not fit what you are asking for, it is ignored.
      </p>
    </div>
  );
}

function SkillDetail({ skill, usage, off, onToggle }: {
  skill: SkillDef; usage?: { count: number; last: number }; off: boolean; onToggle: () => void;
}) {
  const needs = skill.needs.map((id) => SKILL_GRAPH.find((s) => s.id === id)).filter(Boolean) as SkillDef[];
  const neededBy = SKILL_GRAPH.filter((s) => s.needs.includes(skill.id));
  return (
    <div className="p-4">
      <div className="flex items-start gap-2 mb-1">
        <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: AREA_COLOR[skill.area] }} />
        <h3 className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--nv-text)' }}>{skill.name}</h3>
      </div>
      <p className="text-[10px] uppercase tracking-wide mb-2.5 pl-[18px]" style={{ color: 'var(--nv-faint)' }}>{AREA_LABEL[skill.area]}</p>
      <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: 'var(--nv-muted)' }}>{skill.blurb}</p>

      <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>What it tells the agent</h4>
      <p className="text-[11px] leading-relaxed mb-3 px-2.5 py-2 rounded-lg"
        style={{ color: 'var(--nv-text)', background: 'var(--nv-bg)', border: '1px solid var(--nv-border)' }}>{skill.guide}</p>

      {needs.length > 0 && (
        <>
          <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>Comes with</h4>
          <p className="text-[11px] mb-3" style={{ color: 'var(--nv-muted)' }}>
            {needs.map((n) => n.name).join(', ')} — this cannot work without them, so they are attached too.
          </p>
        </>
      )}
      {neededBy.length > 0 && (
        <>
          <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>Needed by</h4>
          <p className="text-[11px] mb-3" style={{ color: 'var(--nv-muted)' }}>{neededBy.map((n) => n.name).join(', ')}</p>
        </>
      )}

      <h4 className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--nv-faint)' }}>
        {skill.tools.length ? `Tools (${skill.tools.length})` : 'Built in'}
      </h4>
      {skill.tools.length ? (
        <div className="flex flex-wrap gap-1 mb-3">
          {skill.tools.map((t) => (
            <span key={t} className="text-[9.5px] font-mono px-1.5 py-0.5 rounded-md"
              style={{ background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>{t}</span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] mb-3" style={{ color: 'var(--nv-muted)' }}>Part of the app itself rather than a tool the model calls.</p>
      )}

      <p className="text-[10.5px] mb-3" style={{ color: 'var(--nv-faint)' }}>
        {usage?.count
          ? `Used ${usage.count} time${usage.count === 1 ? '' : 's'} · last ${new Date(usage.last).toLocaleDateString()}`
          : 'Not used yet.'}
      </p>

      <button
        onClick={onToggle}
        className="w-full text-[11px] px-3 py-1.5 rounded-lg font-medium transition-fast"
        style={off
          ? { background: '#7C5CFF', color: '#fff' }
          : { background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>
        {off ? 'Switch this skill back on' : 'Switch this skill off'}
      </button>
      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--nv-faint)' }}>
        Switching it off stops its guidance being sent. The underlying tools stay available — this changes what
        the agent is told, not what it can reach.
      </p>
    </div>
  );
}
