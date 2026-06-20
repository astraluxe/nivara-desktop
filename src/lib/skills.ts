export type SkillCategory = 'coding' | 'design' | 'agents' | 'writing' | 'cloud';

export interface SkillRegistryEntry {
  id: string;          // "anthropics/claude-api"
  name: string;
  author: string;      // "Anthropic"
  category: SkillCategory;
  description: string;
  rawUrl: string;      // GitHub raw URL to SKILL.md
  agents: 'all' | string[];
}

interface InstalledSkill {
  content: string;
  installedAt: number;
}

type InstalledStore = Record<string, InstalledSkill>;

// ─── Curated registry of skills.sh skills ─────────────────────────────────────
export const SKILLS_REGISTRY: SkillRegistryEntry[] = [
  // ── Coding ──
  {
    id: 'vercel-labs/react-best-practices',
    name: 'React Best Practices',
    author: 'Vercel',
    category: 'coding',
    description: 'React and Next.js performance optimization guidelines from Vercel Engineering.',
    rawUrl: 'https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md',
    agents: 'all',
  },
  {
    id: 'supabase/supabase-postgres-best-practices',
    name: 'Postgres Best Practices',
    author: 'Supabase',
    category: 'coding',
    description: 'Comprehensive Postgres optimization — queries, indexes, RLS, connections, schema design.',
    rawUrl: 'https://raw.githubusercontent.com/supabase/agent-skills/main/skills/supabase-postgres-best-practices/SKILL.md',
    agents: 'all',
  },
  {
    id: 'supabase/supabase',
    name: 'Supabase Platform',
    author: 'Supabase',
    category: 'coding',
    description: 'Full Supabase guide — Auth, Edge Functions, Realtime, Storage, client libraries.',
    rawUrl: 'https://raw.githubusercontent.com/supabase/agent-skills/main/skills/supabase/SKILL.md',
    agents: 'all',
  },
  {
    id: 'anthropics/claude-api',
    name: 'Claude API',
    author: 'Anthropic',
    category: 'coding',
    description: 'Claude API / Anthropic SDK — models, pricing, streaming, tool use, MCP, caching.',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/SKILL.md',
    agents: 'all',
  },
  {
    id: 'anthropics/webapp-testing',
    name: 'Web App Testing',
    author: 'Anthropic',
    category: 'coding',
    description: 'Playwright toolkit for testing local web apps — UI verification, screenshots, browser logs.',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md',
    agents: 'all',
  },

  // ── Design / UI ──
  {
    id: 'shadcn/shadcn-ui',
    name: 'shadcn/ui',
    author: 'shadcn',
    category: 'design',
    description: 'Add, debug, style, and compose shadcn/ui components. Works with components.json projects.',
    rawUrl: 'https://raw.githubusercontent.com/shadcn/ui/main/skills/shadcn/SKILL.md',
    agents: 'all',
  },
  {
    id: 'anthropics/frontend-design',
    name: 'Frontend Design',
    author: 'Anthropic',
    category: 'design',
    description: 'Distinctive, intentional visual design — typography, aesthetic direction, anti-templated defaults.',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md',
    agents: 'all',
  },
  {
    id: 'remotion-dev/remotion',
    name: 'Remotion',
    author: 'Remotion',
    category: 'design',
    description: 'Best practices for creating programmatic videos in React using Remotion.',
    rawUrl: 'https://raw.githubusercontent.com/remotion-dev/skills/main/skills/remotion/SKILL.md',
    agents: 'all',
  },
  {
    id: 'anthropics/canvas-design',
    name: 'Canvas & WebGL',
    author: 'Anthropic',
    category: 'design',
    description: 'Generative art and creative coding using HTML Canvas and WebGL.',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md',
    agents: 'all',
  },

  // ── AI / Agents ──
  {
    id: 'vercel-labs/agent-browser',
    name: 'Agent Browser',
    author: 'Vercel Labs',
    category: 'agents',
    description: 'Browser automation CLI — navigation, form fills, screenshots, web scraping.',
    rawUrl: 'https://raw.githubusercontent.com/vercel-labs/agent-browser/main/skills/agent-browser/SKILL.md',
    agents: 'all',
  },
  {
    id: 'anthropics/mcp-builder',
    name: 'MCP Builder',
    author: 'Anthropic',
    category: 'agents',
    description: 'Build high-quality MCP servers in Python (FastMCP) or TypeScript (MCP SDK).',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md',
    agents: 'all',
  },
  {
    id: 'vercel-labs/find-skills',
    name: 'Find Skills',
    author: 'Vercel Labs',
    category: 'agents',
    description: 'Helps discover and suggest relevant skills when users ask about capabilities.',
    rawUrl: 'https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md',
    agents: 'all',
  },

  // ── Writing / Docs ──
  {
    id: 'anthropics/doc-coauthoring',
    name: 'Doc Co-authoring',
    author: 'Anthropic',
    category: 'writing',
    description: 'Structured workflow for co-authoring docs, proposals, specs, and decision documents.',
    rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/doc-coauthoring/SKILL.md',
    agents: ['boss', 'executive_assistant', 'researcher', 'research_agent'],
  },

  // ── Cloud ──
  {
    id: 'microsoft/azure-ai',
    name: 'Azure AI',
    author: 'Microsoft',
    category: 'cloud',
    description: 'Azure AI services — Search, Speech, OpenAI, Document Intelligence, vector/hybrid search.',
    rawUrl: 'https://raw.githubusercontent.com/microsoft/azure-skills/main/skills/azure-ai/SKILL.md',
    agents: 'all',
  },
];

// ─── Storage keys ──────────────────────────────────────────────────────────────
const INSTALLED_KEY = 'nv-skills-installed-v2';
const ACTIVE_KEY    = 'nv-skills-active-v2';

// ─── Installed skills (downloaded content) ────────────────────────────────────
function getInstalledStore(): InstalledStore {
  try {
    return JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '{}') as InstalledStore;
  } catch {
    return {};
  }
}

export function isSkillInstalled(id: string): boolean {
  return id in getInstalledStore();
}

export async function installSkill(id: string): Promise<void> {
  const entry = SKILLS_REGISTRY.find((s) => s.id === id);
  if (!entry) throw new Error('Unknown skill: ' + id);

  const res = await fetch(entry.rawUrl);
  if (!res.ok) throw new Error(`Failed to fetch skill: ${res.status}`);
  const content = await res.text();

  const store = getInstalledStore();
  store[id] = { content, installedAt: Date.now() };
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(store));

  // Auto-activate on install
  const active = getActiveSkillIds();
  active.add(id);
  localStorage.setItem(ACTIVE_KEY, JSON.stringify([...active]));
}

export function uninstallSkill(id: string): void {
  const store = getInstalledStore();
  delete store[id];
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(store));

  const active = getActiveSkillIds();
  active.delete(id);
  localStorage.setItem(ACTIVE_KEY, JSON.stringify([...active]));
}

// ─── Active skills (injected into agent context) ───────────────────────────────
export function getActiveSkillIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function toggleSkillActive(id: string): boolean {
  const active = getActiveSkillIds();
  if (active.has(id)) {
    active.delete(id);
  } else {
    active.add(id);
  }
  localStorage.setItem(ACTIVE_KEY, JSON.stringify([...active]));
  return active.has(id);
}

// ─── Context injection ────────────────────────────────────────────────────────
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

export function getActiveSkillsContext(agentKey?: string): string {
  const active  = getActiveSkillIds();
  if (active.size === 0) return '';

  const store   = getInstalledStore();
  const entries = SKILLS_REGISTRY.filter((s) => {
    if (!active.has(s.id)) return false;
    if (!store[s.id]) return false;
    if (s.agents === 'all') return true;
    return agentKey ? (s.agents as string[]).includes(agentKey) : true;
  });

  if (entries.length === 0) return '';

  return (
    '\n\n---\n**Active Skills:**\n' +
    entries.map((e) => stripFrontmatter(store[e.id].content)).join('\n\n') +
    '\n---\n'
  );
}

export function getActiveSkillsForCoder(): string {
  const active  = getActiveSkillIds();
  if (active.size === 0) return '';

  const store   = getInstalledStore();
  const entries = SKILLS_REGISTRY.filter(
    (s) => active.has(s.id) && store[s.id] && s.category === 'coding',
  );

  if (entries.length === 0) return '';

  return (
    '\n\n---\n**Active Skills:**\n' +
    entries.map((e) => stripFrontmatter(store[e.id].content)).join('\n\n') +
    '\n---\n'
  );
}

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  coding:  'Coding',
  design:  'Design',
  agents:  'AI / Agents',
  writing: 'Writing',
  cloud:   'Cloud',
};
