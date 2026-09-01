// ─── import.meta.env, for bundles that run in node ───────────────────────────
//
// A .tsx component pulls in supabase.ts, which reads `import.meta.env` at import time and throws in
// node. Injecting this and mapping `import.meta.env` onto it lets a component's PURE exports be
// unit-tested — which is how the title bar's "what is running" decision became testable at all.
//
// It is an inject rather than a --define of a JSON object because the .cmd shim esbuild uses on
// Windows mangles the quotes in one, and the failure looks like a broken bundle rather than a
// broken argument.
export const __NV_ENV__ = {
  VITE_SUPABASE_URL: 'https://stub.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'stub',
};
