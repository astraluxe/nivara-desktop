import { invoke } from '@tauri-apps/api/core';

export interface KrewSession {
  id: string;
  title: string;
  mode: string;
  model: string | null;
  agent_key: string;
  created_at: number;
  last_active: number;
  message_count: number;
}

export interface KrewMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  tool_name: string | null;
  created_at: number;
}

export const krewDb = {
  newSession: (title: string, mode: string, agentKey: string, model?: string) =>
    invoke<string>('db_krew_new_session', { title, mode, agentKey, model: model ?? null }),

  getSessions: () =>
    invoke<KrewSession[]>('db_krew_get_sessions'),

  updateTitle: (sessionId: string, title: string) =>
    invoke<void>('db_krew_update_title', { sessionId, title }),

  saveMessage: (
    sessionId: string,
    role: KrewMessage['role'],
    content: string,
    toolName?: string,
  ) => invoke<void>('db_krew_save_message', {
    sessionId, role, content, toolName: toolName ?? null,
  }),

  getMessages: (sessionId: string) =>
    invoke<KrewMessage[]>('db_krew_get_messages', { sessionId }),

  deleteSession: (sessionId: string) =>
    invoke<void>('db_krew_delete_session', { sessionId }),

  saveSummary: (sessionId: string, summary: string, coversUpTo: number) =>
    invoke<void>('db_krew_save_summary', { sessionId, summary, coversUpTo }),

  getSummary: (sessionId: string) =>
    invoke<{ summary: string; covers_up_to: number } | null>('db_krew_get_summary', { sessionId }),
};

// ─── Krew memory ──────────────────────────────────────────────────────────────

export interface KrewMemory {
  id: number;
  agent_key: string;
  key: string;
  value: string;
  created_at: number;
}

export const krewMemoryDb = {
  save: (agentKey: string, key: string, value: string) =>
    invoke<void>('db_krew_save_memory', { agentKey, key, value }),

  getAll: (agentKey: string) =>
    invoke<KrewMemory[]>('db_krew_get_memories', { agentKey }),

  delete: (agentKey: string, key: string) =>
    invoke<void>('db_krew_delete_memory', { agentKey, key }),
};

// ─── Credential storage ───────────────────────────────────────────────────────

export interface ServiceCredentials {
  [key: string]: string;
}

export const credentialStore = {
  save: (service: string, data: ServiceCredentials) =>
    invoke<void>('store_credential', { service, data: JSON.stringify(data) }),

  get: async (service: string): Promise<ServiceCredentials | null> => {
    const raw = await invoke<string | null>('get_credential', { service });
    if (!raw) return null;
    try { return JSON.parse(raw) as ServiceCredentials; } catch { return null; }
  },

  delete: (service: string) =>
    invoke<void>('delete_credential', { service }),

  list: () =>
    invoke<string[]>('list_credentials'),
};
