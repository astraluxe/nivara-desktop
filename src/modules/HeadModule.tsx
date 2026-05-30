import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Suggestion {
  id: string;
  user_id: string | null;
  email: string | null;
  message: string;
  created_at: string;
}

export default function HeadModule() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('suggestions')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setSuggestions(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-nv-border shrink-0">
        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-accent shrink-0">
          <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.5l-4.8 2.4.9-5.4L2.2 7.7l5.4-.8L10 2z" fill="currentColor"/>
        </svg>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-nv-text leading-tight">Head Dashboard</span>
          <span className="text-[9px] font-mono text-nv-faint leading-tight">User suggestions · admin view</span>
        </div>
        <span className="ml-auto text-[9px] font-mono text-nv-faint shrink-0">
          {loading ? '…' : `${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}`}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono border border-nv-border rounded-lg text-nv-muted hover:border-accent/30 hover:text-accent transition-fast disabled:opacity-40 shrink-0"
        >
          {loading
            ? <><span className="w-2.5 h-2.5 rounded-full border border-current/30 border-t-current animate-spin" />Loading…</>
            : <>
                <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5"><path d="M10 6A4 4 0 112 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 3v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Refresh
              </>
          }
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="text-[11px] text-red-400 font-mono bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && suggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 h-48 text-nv-faint">
            <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8 opacity-30">
              <rect x="4" y="6" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M10 12h12M10 17h8M10 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-[11px] font-mono">No suggestions yet.</span>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            {suggestions.map((s) => (
              <div key={s.id} className="bg-nv-surface border border-nv-border rounded-xl p-3.5 flex flex-col gap-2 hover:border-nv-muted/60 transition-fast">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-accent truncate flex-1 min-w-0">
                    {s.email ?? 'anonymous'}
                  </span>
                  <span className="text-[9px] font-mono text-nv-faint shrink-0">
                    {new Date(s.created_at).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-[12px] text-nv-text leading-relaxed whitespace-pre-wrap">{s.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
