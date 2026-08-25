// Stands in for AuthContext on the visual harness page only, so the real TitleBar and Sidebar can
// be mounted in a browser without Supabase, a session, or a network. Wired in by alias in
// vite.visual.config.ts — src/contexts/AuthContext.tsx itself is never touched.
export const useAuth = () => ({
  profile: { email: 'owner@example.com', first_name: 'Amogh', last_name: 'R', plan: 'builder', admin_level: 'head' },
  user: { email: 'owner@example.com' },
  session: null, loading: false,
  signIn: async () => {}, signOut: async () => {}, refreshProfile: async () => {},
}) as any;
export const AuthProvider = ({ children }: any) => children;
export default { useAuth, AuthProvider };
