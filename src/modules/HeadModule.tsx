import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  plan: string | null;
  type: 'suggestion' | 'error';
  message: string;
  created_at: string;
}

const TYPE_STYLE: Record<string, string> = {
  suggestion: 'text-accent bg-accent/10 border-accent/20',
  error:      'text-nv-red  bg-nv-red/10  border-nv-red/20',
};

const PLAN_STYLE: Record<string, string> = {
  explore: 'text-nv-faint',
  solo:    'text-nv-green',
  growth:  'text-nv-green',
  builder: 'text-accent',
  pro:     'text-nv-yellow',
  custom:  'text-nv-yellow',
};

export default function HeadModule() {
  const [rows, setRows]       = useState<FeedbackRow[]>([]);
  const [filter, setFilter]   = useState<'all' | 'suggestion' | 'error'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const visible = filter === 'all' ? rows : rows.filter(r => r.type === filter);
  const suggestions = rows.filter(r => r.type === 'suggestion').length;
  const errors      = rows.filter(r => r.type === 'error').length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-nv-border shrink-0">
        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-accent shrink-0">
          <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.5l-4.8 2.4.9-5.4L2.2 7.7l5.4-.8L10 2z" fill="currentColor"/>
        </svg>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-nv-text leading-tight">Head Dashboard</span>
          <span className="text-[9px] font-mono text-nv-faint leading-tight">
            {loading ? '…' : `${suggestions} suggestion${suggestions !== 1 ? 's' : ''} · ${errors} error report${errors !== 1 ? 's' : ''}`}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono border border-nv-border rounded-lg text-nv-muted hover:border-accent/30 hover:text-accent transition-fast disabled:opacity-40 shrink-0"
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

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-nv-border shrink-0">
        {(['all', 'suggestion', 'error'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono capitalize transition-fast ${
              filter === f
                ? 'bg-accent/15 text-accent'
                : 'text-nv-faint hover:text-nv-muted'
            }`}
          >
            {f === 'all' ? 'All' : f === 'suggestion' ? 'Suggestions' : 'Error Reports'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="text-[11px] text-red-400 font-mono bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 h-48 text-nv-faint">
            <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8 opacity-30">
              <path d="M28 20a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
            <span className="text-[11px] font-mono">Nothing here yet.</span>
          </div>
        )}

        {visible.length > 0 && (
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            {visible.map((row) => (
              <div key={row.id} className="bg-nv-surface border border-nv-border rounded-xl p-3.5 flex flex-col gap-2 hover:border-nv-muted/60 transition-fast">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type badge */}
                  <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border capitalize shrink-0 ${TYPE_STYLE[row.type] ?? ''}`}>
                    {row.type === 'suggestion' ? 'Suggestion' : 'Error Report'}
                  </span>
                  {/* Plan */}
                  {row.plan && (
                    <span className={`text-[9px] font-mono capitalize shrink-0 ${PLAN_STYLE[row.plan] ?? 'text-nv-faint'}`}>
                      {row.plan}
                    </span>
                  )}
                  {/* Email */}
                  <span className="text-[10px] font-mono text-nv-muted truncate flex-1 min-w-0">
                    {row.email ?? 'anonymous'}
                  </span>
                  {/* Date */}
                  <span className="text-[9px] font-mono text-nv-faint shrink-0">
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-[12px] text-nv-text leading-relaxed whitespace-pre-wrap">{row.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
