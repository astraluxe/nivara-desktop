import { useState, useEffect, useCallback } from 'react';
import {
  SKILLS_REGISTRY,
  SKILL_CATEGORY_LABELS,
  isSkillInstalled,
  installSkill,
  uninstallSkill,
  getActiveSkillIds,
  toggleSkillActive,
  type SkillCategory,
} from '../../lib/skills';

interface Props {
  onClose: () => void;
}

const CATEGORIES: SkillCategory[] = ['coding', 'design', 'agents', 'writing', 'cloud'];

const CATEGORY_ICONS: Record<SkillCategory, JSX.Element> = {
  coding: (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 1 9 4 12"/><polyline points="12 6 15 9 12 12"/><line x1="9" y1="4" x2="7" y2="14"/>
    </svg>
  ),
  design: (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>
    </svg>
  ),
  agents: (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 10.7l-3.8 2.1.7-4.3-3.1-3 4.3-.6z"/>
    </svg>
  ),
  writing: (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12.5l2.5-.5 8-8-2-2-8 8-.5 2.5z"/><line x1="10.5" y1="4.5" x2="11.5" y2="5.5"/>
    </svg>
  ),
  cloud: (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 9.5a3 3 0 0 0-3-3 4 4 0 0 0-7.75 1.5A2.5 2.5 0 0 0 4 12.5h8a2.5 2.5 0 0 0 .5-5z"/>
    </svg>
  ),
};

function useSkillState() {
  const [installed, setInstalled] = useState<Set<string>>(() => {
    return new Set(SKILLS_REGISTRY.filter((s) => isSkillInstalled(s.id)).map((s) => s.id));
  });
  const [active, setActive] = useState<Set<string>>(getActiveSkillIds);

  const refresh = useCallback(() => {
    setInstalled(new Set(SKILLS_REGISTRY.filter((s) => isSkillInstalled(s.id)).map((s) => s.id)));
    setActive(getActiveSkillIds());
  }, []);

  return { installed, active, refresh };
}

export default function SkillsPanel({ onClose }: Props) {
  const [activeTab,   setActiveTab]   = useState<SkillCategory>('coding');
  const [installing,  setInstalling]  = useState<Set<string>>(new Set());
  const [errors,      setErrors]      = useState<Record<string, string>>({});
  const { installed, active, refresh } = useSkillState();

  // Refresh state whenever tab changes (in case another component modified it)
  useEffect(() => { refresh(); }, [activeTab, refresh]);

  async function handleInstall(id: string) {
    setInstalling((prev) => new Set([...prev, id]));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await installSkill(id);
      refresh();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: String(e) }));
    } finally {
      setInstalling((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  function handleUninstall(id: string) {
    uninstallSkill(id);
    refresh();
  }

  function handleToggleActive(id: string) {
    toggleSkillActive(id);
    refresh();
  }

  const tabSkills = SKILLS_REGISTRY.filter((s) => s.category === activeTab);
  const totalActive = active.size;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-nv-bg">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-nv-border shrink-0">
        <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center shrink-0">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#7C5CFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 1l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 10.7l-3.8 2.1.7-4.3-3.1-3 4.3-.6z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-nv-text leading-none">Skills</p>
          <p className="text-[10px] text-nv-faint mt-0.5">from the open agent skills ecosystem</p>
        </div>
        {totalActive > 0 && (
          <span className="text-[9px] font-mono text-accent bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5 shrink-0">
            {totalActive} active
          </span>
        )}
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-nv-faint hover:text-nv-text hover:bg-nv-surface transition-fast shrink-0 ml-1"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
          </svg>
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-0 px-1 pt-1 pb-0 border-b border-nv-border shrink-0 overflow-x-auto">
        {CATEGORIES.map((cat) => {
          const activeCount = SKILLS_REGISTRY.filter((s) => s.category === cat && active.has(s.id)).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono transition-fast border-b-2 -mb-px shrink-0 whitespace-nowrap ${
                activeTab === cat
                  ? 'border-accent text-nv-text'
                  : 'border-transparent text-nv-faint hover:text-nv-muted'
              }`}
            >
              <span className={activeTab === cat ? 'text-accent' : 'text-nv-faint'}>
                {CATEGORY_ICONS[cat]}
              </span>
              {SKILL_CATEGORY_LABELS[cat]}
              {activeCount > 0 && (
                <span className="w-3.5 h-3.5 rounded-full bg-accent/20 text-accent text-[8px] font-bold flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Skill cards */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {tabSkills.map((skill) => {
          const isInst   = installed.has(skill.id);
          const isActive = active.has(skill.id);
          const isLoading = installing.has(skill.id);
          const error    = errors[skill.id];

          return (
            <div
              key={skill.id}
              className={`rounded-xl border p-3 transition-fast ${
                isActive
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-nv-border bg-nv-surface'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <p className="text-[11px] font-semibold text-nv-text leading-none">{skill.name}</p>
                    <span className="text-[8px] text-nv-faint bg-nv-surface2 border border-nv-border/60 rounded px-1 py-0.5 leading-none font-mono">
                      {skill.author}
                    </span>
                    {isActive && (
                      <span className="text-[8px] font-mono text-accent bg-accent/10 px-1 py-0.5 rounded leading-none">
                        active
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-nv-faint leading-snug mt-0.5 line-clamp-2">
                    {skill.description}
                  </p>
                  {error && (
                    <p className="text-[9px] text-nv-bad mt-1 leading-snug">
                      Failed: {error.replace('Error: ', '')}
                    </p>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1 ml-1">
                  {!isInst ? (
                    /* Not installed — show Install button */
                    <button
                      onClick={() => handleInstall(skill.id)}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/25 text-accent text-[9px] font-mono hover:bg-accent/20 transition-fast disabled:opacity-50 whitespace-nowrap"
                    >
                      {isLoading ? (
                        <>
                          <svg width="8" height="8" viewBox="0 0 16 16" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 2a6 6 0 1 0 6 6" strokeLinecap="round"/>
                          </svg>
                          Installing…
                        </>
                      ) : (
                        <>
                          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M8 2v8M4 10l4 4 4-4M2 14h12"/>
                          </svg>
                          Install
                        </>
                      )}
                    </button>
                  ) : (
                    /* Installed — show active toggle + uninstall */
                    <>
                      <button
                        onClick={() => handleToggleActive(skill.id)}
                        className={`w-8 h-4.5 rounded-full relative transition-colors ${isActive ? 'bg-accent' : 'bg-nv-border'}`}
                        style={{ height: '18px', width: '32px' }}
                        title={isActive ? 'Deactivate' : 'Activate'}
                      >
                        <div
                          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${isActive ? 'left-[17px]' : 'left-0.5'}`}
                        />
                      </button>
                      <button
                        onClick={() => handleUninstall(skill.id)}
                        className="text-[8px] text-nv-faint hover:text-nv-bad transition-fast font-mono"
                        title="Uninstall"
                      >
                        remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-nv-border shrink-0 flex items-center gap-2">
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-nv-faint shrink-0">
          <circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11" r=".5" fill="currentColor"/>
        </svg>
        <p className="text-[9px] text-nv-faint leading-snug">
          Skills are downloaded from their official GitHub repositories and injected into agent context.
        </p>
      </div>
    </div>
  );
}
