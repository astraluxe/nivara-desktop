// Stubs so the real components can be mounted in a plain browser for testing.
//
// `invoke` records every call and answers from a script the test sets up, so a send run can be
// driven end to end — including the failure paths, which are the ones that matter most and the
// ones a live test could never produce on demand.
type Reply = string | { error: string } | { json: unknown };

export const invoke = async (cmd: string, args?: unknown) => {
  const w = window as any;
  w.__calls = [...(w.__calls || []), { cmd, args }];
  const script: Record<string, Reply | Reply[]> = w.__invokeReplies || {};
  let reply = script[cmd];
  if (Array.isArray(reply)) {
    // A list is consumed one call at a time, so a run can succeed, then fail, then succeed.
    const queue = reply as Reply[];
    reply = queue.length > 1 ? queue.shift()! : queue[0];
  }
  if (reply && typeof reply === 'object' && 'error' in reply) throw new Error(reply.error);
  // A STRUCTURED REPLY. Several commands return arrays or objects, not strings — list_dir is the
  // obvious one — and handing those callers a bare '' made them throw "object is not iterable"
  // the moment the component mounted. { json: … } is returned as-is so a test can describe real
  // data instead of only strings.
  if (reply && typeof reply === 'object' && 'json' in (reply as Record<string, unknown>)) {
    return (reply as unknown as { json: unknown }).json;
  }
  return (reply as string) ?? '';
};

export const listen = async (_e: string, _cb: unknown) => () => {};
export const emit = async (..._a: unknown[]) => {};
export const open = async (url: string) => {
  const w = window as any;
  w.__opened = [...(w.__opened || []), url];
};
export const convertFileSrc = (p: string) => p;
export const getCurrentWindow = () => ({ label: 'main' });
export default {};
