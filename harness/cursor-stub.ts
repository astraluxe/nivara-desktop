// Feeds the REAL cursor and ask components a fixed state so they can be screenshotted without the
// Tauri runtime. Only the transport is faked; the components are the shipped ones.
const CURSOR = {
  visible: true, x: 420, y: 300,
  rgb: 'var(--nv-dept-sales)', agent: 'Meera',
  doing: 'writing "Proposal for Acme" (3/7)',
  step: 3, total: 7,
};
const QUESTION = {
  id: 'q1', agent: 'Meera', rgb: 'var(--nv-dept-sales)',
  question: 'Which account should I post from?',
  because: 'Your X and your LinkedIn are signed in on different Google accounts.',
  at: { x: 0, y: 0 },
  rememberAs: 'social-account',
  options: [
    { id: 'work', label: 'amogh@adris.tech', detail: 'LinkedIn is signed in here' },
    { id: 'personal', label: 'astraluxe.tech@gmail.com', detail: 'X is signed in here' },
  ],
};
export const listen = async (event: string, cb: (e: { payload: unknown }) => void) => {
  setTimeout(() => cb({ payload: event.includes('ask') ? QUESTION : CURSOR }), 0);
  return () => {};
};
export const emit = async () => {};
export const invoke = async () => '';
export const getCurrentWindow = () => ({});
