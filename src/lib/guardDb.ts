import { invoke } from '@tauri-apps/api/core';

export interface GuardEvent {
  id: string;
  event_type: 'contract_scan' | 'phishing_detected' | 'suspicious_login' | 'cve_found' | 'compliance_check' | 'malicious_domain';
  severity: 'low' | 'med' | 'high' | 'crit';
  description: string;
  metadata: string | null;
  hash: string;
  created_at: string;
}

export interface GuardStats {
  total: number;
  threats: number;
  contract_scans: number;
  phishing_detected: number;
  cve_found: number;
  login_flags: number;
}

export const guardDb = {
  log: (event_type: string, severity: string, description: string, metadata?: object) =>
    invoke<string>('guard_log_event', {
      eventType: event_type,
      severity,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
    }),
  events: (limit = 50) => invoke<GuardEvent[]>('guard_get_events', { limit }),
  stats: ()           => invoke<GuardStats>('guard_get_stats'),
};
