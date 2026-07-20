// Passes a preselected service from krewTools → ConnectApps, and remembers which service's setup
// wizard is currently open. Persisted to localStorage (not just an in-memory singleton) because
// App.tsx only mounts <ConnectApps/> while activeModule === 'connect' — switching to another tab
// and back unmounts/remounts it, and an in-memory value would already have been consumed-and-lost
// on the first mount, making the wizard silently "vanish" on return.
const STORAGE_KEY = 'nv-connect-apps-pending-service';

export function requestServiceSetup(service: string): void {
  try { localStorage.setItem(STORAGE_KEY, service); } catch { /* ignore */ }
}

export function peekServiceRequest(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function clearServiceRequest(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
