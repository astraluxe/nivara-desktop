// Singleton used to pass a preselected service from krewTools → ConnectApps.
// The tool sets this, ConnectApps consumes it on mount.
let _pending: string | null = null;

export function requestServiceSetup(service: string): void {
  _pending = service;
}

export function consumeServiceRequest(): string | null {
  const s = _pending;
  _pending = null;
  return s;
}
