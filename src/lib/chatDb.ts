import { invoke } from '@tauri-apps/api/core';

export interface ChatSession {
  id: string;
  project_path: string;
  mode: string;
  model: string | null;
  created_at: number;
  last_active: number;
  title: string | null;
  message_count: number;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  tokens: number;
  created_at: number;
}

export const chatDb = {
  newSession: (projectPath: string, mode: string, model?: string) =>
    invoke<string>('db_new_session', { projectPath, mode, model: model ?? null }),

  saveMessage: (sessionId: string, role: 'user' | 'assistant', content: string, tokens = 0) =>
    invoke<void>('db_save_message', { sessionId, role, content, tokens }),

  getSessions: (projectPath: string) =>
    invoke<ChatSession[]>('db_get_sessions', { projectPath }),

  getMessages: (sessionId: string) =>
    invoke<ChatMessage[]>('db_get_messages', { sessionId }),

  deleteSession: (sessionId: string) =>
    invoke<void>('db_delete_session', { sessionId }),

  deleteAll: (projectPath: string) =>
    invoke<void>('db_delete_all', { projectPath }),

  getRecentSessions: (limit = 3) =>
    invoke<ChatSession[]>('db_get_recent_sessions', { limit }),
};
