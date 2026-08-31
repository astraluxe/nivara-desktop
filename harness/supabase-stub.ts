// A Supabase client that answers from `window.__usageRows`, so screens that read the database can
// be LOOKED AT in a plain browser. Only the query shape the visual pages actually use is
// implemented — a chainable select/eq/gte/order that resolves to the stubbed rows.

interface Row { [k: string]: unknown }

function query(rows: Row[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    // Awaiting the chain itself is how the real client resolves a query.
    then: (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: rows, error: null }),
  };
  return chain;
}

export const supabase = {
  auth: {
    getSession: async () => ({
      data: { session: { user: { id: 'visual-user' }, access_token: 'visual-token' } },
    }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: (table: string) => {
    const w = window as unknown as { __usageRows?: Row[] };
    return query(table === 'token_usage' ? (w.__usageRows ?? []) : []);
  },
};

export default { supabase };
