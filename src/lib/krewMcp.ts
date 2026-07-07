// ─── Generic MCP (Model Context Protocol) client ─────────────────────────────
// Lets a user connect Krew to ANY MCP server by URL — the same open standard
// hundreds of tools already speak (Notion, Linear, Zapier, Composio, Smithery,
// Higgsfield, your own self-hosted server, …). We implement the Streamable-HTTP
// transport directly: initialize → notifications/initialized → tools/list →
// tools/call, over the `mcp_http_call` Rust bridge (which exposes the
// `mcp-session-id` header and raw SSE body we need). Discovered tools are cached
// locally and surfaced to every Krew specialist agent as normal tools, namespaced
// `mcp__<serverId>__<toolName>` so the agent can call them like anything else.
//
// This is a clean-room implementation of the public MCP spec — no third-party
// agent framework code is used.

import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import type { ToolDef, ToolParam } from './krewTools';

const MCP_STORE_KEY = '__mcp_servers__';
const PROTOCOL_VERSION = '2025-06-18';

export interface McpToolMeta {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface McpServer {
  id:         string;   // slug, no double-underscores (used in tool namespacing)
  name:       string;   // friendly label shown to the user
  url:        string;   // the MCP endpoint, e.g. https://mcp.notion.com/mcp
  authHeader?: string;  // header name for auth (default "Authorization")
  authValue?: string;   // token / bearer value (optional)
  tools:      McpToolMeta[];
  addedAt:    number;
}

interface McpRpcResult {
  result?: unknown;
  error?:  { code?: number; message?: string };
}

// ─── Persistence (reuses the encrypted local credential store) ────────────────

export async function listMcpServers(): Promise<McpServer[]> {
  const raw = await credentialStore.get(MCP_STORE_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse((raw as Record<string, string>).json ?? '[]');
    return Array.isArray(parsed) ? (parsed as McpServer[]) : [];
  } catch {
    return [];
  }
}

async function saveServers(servers: McpServer[]): Promise<void> {
  await credentialStore.save(MCP_STORE_KEY, { json: JSON.stringify(servers) });
}

function slugify(name: string, existing: McpServer[]): string {
  const base = (name || 'server')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'server';
  let id = base;
  let n = 2;
  while (existing.some((s) => s.id === id)) id = `${base}-${n++}`;
  return id;
}

// ─── Transport: one JSON-RPC round-trip over Streamable HTTP ──────────────────

interface RpcEnvelope { status: number; body: string; session_id: string; content_type: string }

function parseRpcBody(env: RpcEnvelope, wantId: number): McpRpcResult {
  const body = env.body?.trim() ?? '';
  if (!body) return {};
  // SSE-framed response: pull the JSON out of `data:` lines.
  if (env.content_type.includes('text/event-stream') || body.startsWith('event:') || body.startsWith('data:')) {
    const payloads: string[] = [];
    let buf = '';
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        buf += line.slice(5).trim();
      } else if (line.trim() === '') {
        if (buf) { payloads.push(buf); buf = ''; }
      }
    }
    if (buf) payloads.push(buf);
    // Prefer the message whose id matches our request and that carries a result/error.
    let fallback: McpRpcResult = {};
    for (const p of payloads) {
      try {
        const obj = JSON.parse(p) as McpRpcResult & { id?: number };
        if (obj && (obj.result !== undefined || obj.error)) {
          if (obj.id === wantId) return obj;
          fallback = obj;
        }
      } catch { /* skip non-JSON keepalives */ }
    }
    return fallback;
  }
  // Plain JSON.
  try {
    return JSON.parse(body) as McpRpcResult;
  } catch {
    return { error: { message: body.slice(0, 200) } };
  }
}

async function rpc(
  server: McpServer,
  method: string,
  params: Record<string, unknown> | undefined,
  id: number | null,
  sessionId: string,
): Promise<{ result: McpRpcResult; sessionId: string }> {
  const headers: Record<string, string> = {};
  if (server.authValue) {
    const headerName = server.authHeader || 'Authorization';
    const scheme = /\s/.test(server.authValue) ? '' : 'Bearer ';
    headers[headerName] = `${scheme}${server.authValue}`;
  }
  const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== null) payload.id = id;
  if (params !== undefined) payload.params = params;

  const env = await invoke<RpcEnvelope>('mcp_http_call', {
    url:       server.url,
    headers,
    body:      JSON.stringify(payload),
    sessionId: sessionId || null,
  });
  return {
    result:    id === null ? {} : parseRpcBody(env, id),
    sessionId: env.session_id || sessionId,
  };
}

// Full handshake, returns a live session id for follow-up calls.
async function handshake(server: McpServer): Promise<string> {
  const init = await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'Krew', version: '1.0' },
  }, 1, '');
  if (init.result.error) {
    throw new Error(init.result.error.message || 'MCP initialize failed');
  }
  const sid = init.sessionId;
  // Tell the server we're ready (best-effort; servers reply 202 with no body).
  await rpc(server, 'notifications/initialized', {}, null, sid).catch(() => {});
  return sid;
}

// ─── Public operations ────────────────────────────────────────────────────────

/** Connect to a new (or existing) MCP server: handshake, list tools, persist. */
export async function connectMcpServer(input: {
  name: string; url: string; authHeader?: string; authValue?: string;
}): Promise<McpServer> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Enter a full MCP server URL starting with https://');
  }
  const servers = await listMcpServers();
  const existing = servers.find((s) => s.url === url);
  const server: McpServer = existing ?? {
    id:   slugify(input.name || hostOf(url), servers),
    name: input.name?.trim() || hostOf(url),
    url,
    addedAt: Date.now(),
    tools: [],
  };
  server.name = input.name?.trim() || server.name;
  server.authHeader = input.authHeader?.trim() || undefined;
  server.authValue  = input.authValue?.trim()  || undefined;

  const sid = await handshake(server);
  const listed = await rpc(server, 'tools/list', {}, 2, sid);
  if (listed.result.error) {
    throw new Error(listed.result.error.message || 'Server did not return its tools');
  }
  const tools = ((listed.result.result as { tools?: McpToolMeta[] })?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema,
  }));
  server.tools = tools;

  const next = existing
    ? servers.map((s) => (s.id === server.id ? server : s))
    : [...servers, server];
  await saveServers(next);
  return server;
}

export async function removeMcpServer(id: string): Promise<void> {
  const servers = await listMcpServers();
  await saveServers(servers.filter((s) => s.id !== id));
}

/** Re-discover tools for an already-saved server. */
export async function refreshMcpServer(id: string): Promise<McpServer> {
  const servers = await listMcpServers();
  const server = servers.find((s) => s.id === id);
  if (!server) throw new Error('Server not found');
  return connectMcpServer({
    name: server.name, url: server.url,
    authHeader: server.authHeader, authValue: server.authValue,
  });
}

// ─── Exposing MCP tools to agents ─────────────────────────────────────────────

/** Build ToolDefs (namespaced) for every cached MCP tool, for the agent prompt. */
export function mcpToolDefs(servers: McpServer[]): ToolDef[] {
  const defs: ToolDef[] = [];
  for (const s of servers) {
    for (const t of s.tools) {
      const parameters: Record<string, ToolParam> = {};
      const props = t.inputSchema?.properties ?? {};
      const required = t.inputSchema?.required ?? [];
      for (const [key, schema] of Object.entries(props)) {
        parameters[key] = {
          type: schema.type || 'string',
          description: schema.description || '',
          required: required.includes(key),
        };
      }
      defs.push({
        name: `mcp__${s.id}__${t.name}`,
        description: `[${s.name}] ${t.description || t.name}`.slice(0, 480),
        parameters,
      });
    }
  }
  return defs;
}

export function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__');
}

/** Execute a namespaced MCP tool call: handshake + tools/call, return text. */
export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const rest = toolName.slice('mcp__'.length);
  const servers = await listMcpServers();
  const server = servers.find((s) => rest.startsWith(`${s.id}__`));
  if (!server) return `MCP server for "${toolName}" is no longer connected. Ask the user to reconnect it in Connect Apps.`;
  const origName = rest.slice(server.id.length + 2);

  try {
    const sid = await handshake(server);
    const called = await rpc(server, 'tools/call', { name: origName, arguments: args }, 3, sid);
    if (called.result.error) {
      return `MCP tool "${origName}" on ${server.name} returned an error: ${called.result.error.message ?? 'unknown error'}`;
    }
    return renderToolResult(called.result.result);
  } catch (e) {
    return `Could not reach MCP server "${server.name}": ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Flatten the MCP `content` array (text / json / resource) into a readable string.
function renderToolResult(result: unknown): string {
  if (result == null) return 'Done (no content returned).';
  const r = result as { content?: Array<{ type?: string; text?: string; [k: string]: unknown }>; isError?: boolean; structuredContent?: unknown };
  const parts: string[] = [];
  if (Array.isArray(r.content)) {
    for (const c of r.content) {
      if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else if (c.type === 'resource') parts.push(JSON.stringify(c.resource ?? c));
      else parts.push(JSON.stringify(c));
    }
  }
  if (!parts.length && r.structuredContent !== undefined) {
    parts.push(typeof r.structuredContent === 'string' ? r.structuredContent : JSON.stringify(r.structuredContent));
  }
  if (!parts.length) parts.push(JSON.stringify(result));
  const text = parts.join('\n').trim();
  return (r.isError ? '[tool reported an error] ' : '') + (text || 'Done (empty result).');
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}
