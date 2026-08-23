// Stubs so the real components can be mounted in a plain browser for testing.
export const invoke = async (cmd: string, args?: unknown) => {
  (window as any).__calls = [...((window as any).__calls || []), { cmd, args }];
  return '';
};
export const listen = async (_e: string, _cb: unknown) => () => {};
export const emit = async (..._a: unknown[]) => {};
export const open = async (url: string) => {
  (window as any).__opened = [...((window as any).__opened || []), url];
};
export const convertFileSrc = (p: string) => p;
export const getCurrentWindow = () => ({ label: 'main' });
export default {};
