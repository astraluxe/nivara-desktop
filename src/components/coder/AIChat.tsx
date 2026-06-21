import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../../contexts/AuthContext';
import { getPlanConfig } from '../../lib/planConfig';
import UpgradeModal from '../UpgradeModal';
import { streamAI, type ConnectionMode, type Provider, type AiMessage } from '../../lib/ai';
import { chatDb, type ChatSession, type ChatMessage } from '../../lib/chatDb';
import { trackTokenUsage, getMonthlyUsage } from '../../lib/tokenTracker';
import ConnectionBar from './ConnectionBar';
import PromptLibrary from './PromptLibrary';
import { getActiveSkillsForCoder } from '../../lib/skills';

interface Props {
  projectPath: string;
  currentFileContent: string;
  currentFilePath: string | null;
  dirContext?: string;
  getTerminalContext: () => string;
  onRunInTerminal: (cmd: string) => void;
  onInsertAtCursor: (text: string) => void;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function CodeBlock({ code, lang, onRun, onInsert, onApply, applyLabel }: {
  code: string; lang: string;
  onRun: (c: string) => void;
  onInsert: (c: string) => void;
  onApply?: (c: string) => void;
  applyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function apply() {
    if (!onApply) return;
    onApply(code);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  }
  const isRunnable = ['bash','sh','shell','zsh','fish','cmd','powershell','ps1',''].includes(lang.toLowerCase());
  return (
    <div className="my-1.5 rounded-lg overflow-hidden border border-nv-border/60">
      <div className="flex items-center justify-between px-3 py-1 bg-nv-surface2 border-b border-nv-border/60">
        <span className="text-[10px] text-nv-faint font-mono">{lang || 'code'}</span>
        <div className="flex items-center gap-2">
          {isRunnable && (
            <button
              onClick={() => onRun(code)}
              className="text-[10px] text-nv-green hover:text-nv-green/80 transition-fast"
            >▶ Run</button>
          )}
          {onApply && (
            <button
              onClick={apply}
              className={`text-[10px] transition-fast font-semibold ${applied ? 'text-emerald-400' : 'text-accent hover:text-accent/80'}`}
            >{applied ? '✓ Applied' : `Apply${applyLabel ? ` to ${applyLabel}` : ''}`}</button>
          )}
          <button
            onClick={() => onInsert(code)}
            className="text-[10px] text-nv-muted hover:text-nv-text transition-fast"
          >Insert</button>
          <button
            onClick={copy}
            className="text-[10px] text-nv-muted hover:text-nv-text transition-fast"
          >{copied ? '✓' : 'Copy'}</button>
        </div>
      </div>
      <pre className="p-3 overflow-x-auto text-[11px] leading-relaxed text-nv-text bg-nv-bg font-mono whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}
      className="text-[10px] text-nv-faint hover:text-nv-muted transition-fast font-mono flex items-center gap-1 mt-1"
    >
      {copied
        ? <><span className="text-emerald-400">✓</span> copied</>
        : <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> copy</>
      }
    </button>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  let last = 0; let key = 0; let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) result.push(text.slice(last, m.index));
    if      (m[1] !== undefined) result.push(<strong key={key++} className="text-nv-text font-semibold">{m[1]}</strong>);
    else if (m[2] !== undefined) result.push(<em key={key++} className="italic text-nv-text/80">{m[2]}</em>);
    else                         result.push(<code key={key++} className="bg-nv-surface2 px-1 rounded text-[10px] font-mono text-accent">{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

function renderMarkdown(
  content: string,
  onRun: (c: string) => void,
  onInsert: (c: string) => void,
  onApply?: (c: string) => void,
  applyLabel?: string,
): React.ReactNode[] {
  const segments = content.split(/(```[\s\S]*?```)/g);
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const seg of segments) {
    if (seg.startsWith('```')) {
      const match = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang  = match?.[1] ?? '';
      const code  = match?.[2] ?? seg.slice(3, -3);
      nodes.push(<CodeBlock key={key++} code={code.trim()} lang={lang} onRun={onRun} onInsert={onInsert} onApply={onApply} applyLabel={applyLabel} />);
      continue;
    }
    if (!seg.trim()) continue;

    const lines = seg.split('\n');
    let bullets:  string[] = [];
    let numbered: string[] = [];

    const flushBullets = () => {
      if (!bullets.length) return;
      nodes.push(
        <ul key={key++} className="list-disc pl-4 mb-1.5 space-y-0.5">
          {bullets.map((b, i) => (
            <li key={i} className="text-nv-muted text-[12px] leading-relaxed">{renderInline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    };
    const flushNumbered = () => {
      if (!numbered.length) return;
      nodes.push(
        <ol key={key++} className="list-decimal pl-4 mb-1.5 space-y-0.5">
          {numbered.map((n, i) => (
            <li key={i} className="text-nv-muted text-[12px] leading-relaxed">{renderInline(n)}</li>
          ))}
        </ol>
      );
      numbered = [];
    };

    for (const line of lines) {
      const hm = line.match(/^(#{1,6})\s+(.*)/);
      if (hm) {
        flushBullets(); flushNumbered();
        const lvl = hm[1].length;
        const cls = lvl <= 2 ? 'text-[14px] font-bold text-nv-text mt-2 mb-1'
                  : lvl <= 4 ? 'text-[13px] font-semibold text-nv-text mt-1.5 mb-0.5'
                  :            'text-[12px] font-semibold text-nv-text mt-1 mb-0.5';
        nodes.push(<p key={key++} className={cls}>{renderInline(hm[2])}</p>);
        continue;
      }
      const bm = line.match(/^[*\-+]\s+(.*)/);
      if (bm) { flushNumbered(); bullets.push(bm[1]); continue; }
      const nm = line.match(/^\d+[.)]\s+(.*)/);
      if (nm) { flushBullets(); numbered.push(nm[1]); continue; }
      const qm = line.match(/^>\s*(.*)/);
      if (qm) {
        flushBullets(); flushNumbered();
        nodes.push(<p key={key++} className="border-l-2 border-accent/30 pl-2 text-[12px] text-nv-faint italic mb-1">{renderInline(qm[1])}</p>);
        continue;
      }
      if (!line.trim()) { flushBullets(); flushNumbered(); continue; }
      flushBullets(); flushNumbered();
      nodes.push(<p key={key++} className="text-nv-muted text-[12px] mb-1 leading-relaxed">{renderInline(line)}</p>);
    }
    flushBullets();
    flushNumbered();
  }

  return nodes;
}

function MessageBubble({ msg, onRun, onInsert, onApply, applyLabel }: {
  msg: DisplayMessage;
  onRun: (c: string) => void;
  onInsert: (c: string) => void;
  onApply?: (c: string) => void;
  applyLabel?: string;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-2`}>
      <div className={`max-w-[85%] ${isUser
        ? 'bg-accent/15 border border-accent/30 rounded-2xl rounded-tr-sm px-3 py-2'
        : 'text-nv-text'}`}>
        {isUser ? (
          <p className="text-[12px] text-nv-text">{msg.content}</p>
        ) : (
          <div className="text-[12px] leading-relaxed">
            {renderMarkdown(msg.content, onRun, onInsert, onApply, applyLabel)}
            {msg.streaming && (
              <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse ml-0.5 rounded-sm" />
            )}
          </div>
        )}
      </div>
      {!msg.streaming && msg.content.length > 0 && <CopyBtn text={msg.content} />}
    </div>
  );
}

export default function AIChat({
  projectPath, currentFileContent, currentFilePath, dirContext,
  getTerminalContext, onRunInTerminal, onInsertAtCursor,
}: Props) {
  const [mode, setMode]               = useState<ConnectionMode>('nivara');
  const [apiKey, setApiKey]           = useState('');
  const [provider, setProvider]       = useState<Provider>('openai');
  const [modelName, setModelName]     = useState('gpt-4o');
  const [baseUrl, setBaseUrl]         = useState('');
  const [localModel, setLocalModel]   = useState('llama3');
  const [messages, setMessages]           = useState<DisplayMessage[]>([]);
  const [input, setInput]                 = useState('');
  const [busy, setBusy]                   = useState(false);
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [showHistory, setShowHistory]     = useState(false);
  const [sessions, setSessions]           = useState<ChatSession[]>([]);
  const [showPrompts, setShowPrompts]     = useState(false);
  const [monthlyUsed, setMonthlyUsed]     = useState(0);
  const [showQuotaUpgrade, setShowQuotaUpgrade] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Plan / voice gate
  const { profile, session } = useAuth();
  const planCfg      = getPlanConfig(profile?.plan ?? 'explore');
  const [showVoiceUpgrade, setShowVoiceUpgrade] = useState(false);

  useEffect(() => {
    const plan = profile?.plan ?? 'explore';
    const isLifetime = plan === 'free' || plan === 'explore';
    getMonthlyUsage(isLifetime).then(setMonthlyUsed).catch(() => {});
  }, [profile?.plan]);

  // Voice state
  type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceErr, setVoiceErr]       = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Ctrl+Shift+V shortcut to toggle recording
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        handleMicClick();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceStatus]);

  async function handleMicClick() {
    setVoiceErr(null);

    if (!planCfg.voiceToCode) {
      setShowVoiceUpgrade(true);
      return;
    }

    if (voiceStatus === 'recording') {
      setVoiceStatus('transcribing');
      try {
        const text = await invoke<string>('voice_stop_and_transcribe');
        if (text) setInput(prev => prev ? `${prev} ${text}` : text);
      } catch (e) {
        setVoiceErr(`${e}`);
      }
      setVoiceStatus('idle');
      return;
    }

    if (voiceStatus === 'idle') {
      try {
        await invoke('voice_start_recording');
        setVoiceStatus('recording');
      } catch (e) {
        setVoiceErr(`Microphone error: ${e}`);
        setVoiceStatus('error');
      }
    }
  }

  function buildContext(): string {
    const parts: string[] = [];
    parts.push(
      `You are an expert coding assistant embedded in the adris.tech desktop IDE.\n` +
      `You have full access to the user's project folder. When asked to edit or modify a file, ` +
      `output the COMPLETE updated file content inside a single fenced code block — it will be automatically written to disk immediately, no user action needed.\n` +
      `ALWAYS output the full file (never just the changed section) so it can safely overwrite.\n` +
      `Do NOT explain what you changed after the code block — the user can see the diff. Just output the code.\n` +
      `Always use the project structure below for correct paths.`
    );
    if (projectPath) parts.push(`Project root: ${projectPath}`);
    if (dirContext)  parts.push(`Project structure:\n${dirContext}`);
    if (currentFilePath) {
      parts.push(`Currently open file: ${currentFilePath}\n\`\`\`\n${currentFileContent.slice(0, 6000)}\n\`\`\``);
    }
    const term = getTerminalContext();
    if (term.trim()) parts.push(`Last terminal output:\n\`\`\`\n${term}\n\`\`\``);
    const coderSkills = getActiveSkillsForCoder();
    if (coderSkills) parts.push(coderSkills);
    return parts.join('\n\n');
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const id = await chatDb.newSession(projectPath || '/', mode, localModel);
    setSessionId(id);
    return id;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const tokenCap = planCfg.monthlyTokens;
    if (tokenCap !== null && monthlyUsed >= tokenCap) {
      setShowQuotaUpgrade(true);
      return;
    }
    setInput('');
    setBusy(true);

    const ctx = buildContext();
    const userContent = ctx ? `${ctx}\n\n---\n${text}` : text;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    const sid = await ensureSession().catch(() => null);
    if (sid) chatDb.saveMessage(sid, 'user', text).catch(() => {});

    const history: AiMessage[] = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: 'user', content: userContent });

    let assistantText = '';
    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

    const cleanup = await streamAI({
      mode, messages: history, apiKey, provider, localModel, modelName, baseUrl,
      sessionToken: session?.access_token ?? undefined,
      onChunk: (chunk) => {
        assistantText += chunk;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: assistantText, streaming: true };
          return copy;
        });
      },
      onDone: () => {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: assistantText, streaming: false };
          return copy;
        });
        if (sid) chatDb.saveMessage(sid, 'assistant', assistantText).catch(() => {});
        if (mode === 'nivara') {
          const chars = userContent.length + assistantText.length;
          trackTokenUsage('coder', chars);
          setMonthlyUsed(prev => prev + Math.ceil(chars / 4));
        }
        // Auto-apply: if a file is open and AI returned exactly one code block, write it immediately
        if (currentFilePath) {
          const codeBlocks = [...assistantText.matchAll(/```(?:\w+)?\n?([\s\S]*?)```/g)];
          if (codeBlocks.length === 1) {
            const code = codeBlocks[0][1].trim();
            if (code.length > 30) {
              invoke('write_file', { path: currentFilePath, content: code }).catch(() => {});
            }
          }
        }
        setBusy(false);
        cleanupRef.current = null;
      },
      onError: (err) => {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err}`, streaming: false };
          return copy;
        });
        setBusy(false);
        cleanupRef.current = null;
      },
    }).catch((e) => {
      setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: `Error: ${e}` }]);
      setBusy(false);
      return null;
    });

    if (cleanup) cleanupRef.current = cleanup;
  }

  function stop() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length && copy[copy.length - 1].streaming) {
        copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: false };
      }
      return copy;
    });
    setBusy(false);
  }

  function newSession() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setMessages([]);
    setSessionId(null);
    setBusy(false);
  }

  async function openHistory() {
    const list = await chatDb.getRecentSessions(30).catch(() => [] as ChatSession[]);
    setSessions(list);
    setShowHistory(true);
  }

  async function loadSession(s: ChatSession) {
    const msgs = await chatDb.getMessages(s.id).catch(() => [] as ChatMessage[]);
    setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
    setSessionId(s.id);
    setShowHistory(false);
  }

  const handleSelect = useCallback((p: string) => setInput(p), []);

  if (showPrompts) {
    return (
      <div className="flex flex-col h-full">
        <PromptLibrary onSelect={handleSelect} onClose={() => setShowPrompts(false)} />
      </div>
    );
  }

  if (showHistory) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 h-10 border-b border-nv-border shrink-0">
          <span className="text-[11px] font-semibold text-nv-text uppercase tracking-wider">History</span>
          <button onClick={() => setShowHistory(false)} className="text-nv-faint hover:text-nv-text text-xl transition-fast">×</button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {sessions.length === 0 ? (
            <p className="text-center text-nv-faint text-[11px] pt-8">No sessions yet</p>
          ) : sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSession(s)}
              className="w-full text-left px-2 py-2 rounded hover:bg-nv-surface2 transition-fast"
            >
              <p className="text-[11px] text-nv-text truncate">{s.title ?? `Session ${s.id.slice(0, 8)}`}</p>
              <p className="text-[10px] text-nv-faint mt-0.5">
                {new Date(s.last_active * 1000).toLocaleString()} · {s.message_count} msgs · {s.mode}
              </p>
            </button>
          ))}
        </div>
        {sessions.length > 0 && (
          <div className="p-3 border-t border-nv-border">
            <button
              onClick={() => chatDb.deleteAll(projectPath || '/').then(() => setSessions([]))}
              className="w-full text-[11px] py-1.5 rounded border border-nv-red/40 text-nv-red/70
                hover:border-nv-red hover:text-nv-red transition-fast"
            >Clear all history</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-nv-border shrink-0">
        <span className="text-[11px] font-semibold text-nv-text uppercase tracking-wider">AI</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPrompts(true)}
            title="Prompt library"
            className="text-nv-faint hover:text-nv-text text-[11px] transition-fast px-1"
          >⌘</button>
          <button
            onClick={openHistory}
            title="Chat history"
            className="text-nv-faint hover:text-nv-text text-[11px] transition-fast px-1"
          >≡</button>
          <button
            onClick={newSession}
            title="New session"
            className="text-nv-faint hover:text-nv-text text-[11px] transition-fast px-1"
          >+</button>
        </div>
      </div>

      {/* Connection bar */}
      <div className="px-2 py-2 border-b border-nv-border shrink-0">
        <ConnectionBar
          mode={mode} onModeChange={setMode}
          apiKey={apiKey} onApiKeyChange={setApiKey}
          provider={provider} onProviderChange={setProvider}
          modelName={modelName} onModelNameChange={setModelName}
          baseUrl={baseUrl} onBaseUrlChange={setBaseUrl}
          localModel={localModel} onLocalModelChange={setLocalModel}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-nv-faint text-[11px] text-center">
              Ask anything about your code.<br/>
              <span className="text-nv-faint/60">File + terminal context auto-injected.</span>
            </p>
            <button
              onClick={() => setShowPrompts(true)}
              className="mt-2 text-[11px] px-3 py-1 rounded-lg border border-nv-border
                text-nv-muted hover:border-accent hover:text-accent transition-fast"
            >Browse prompts</button>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={i} msg={msg}
                onRun={onRunInTerminal}
                onInsert={onInsertAtCursor}
                onApply={currentFilePath ? (code: string) => invoke('write_file', { path: currentFilePath, content: code }) : undefined}
                applyLabel={currentFilePath ? currentFilePath.split(/[\\/]/).pop() : undefined}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-nv-border shrink-0">
        {voiceErr && (
          <p className="text-[10px] text-nv-red mb-1.5 px-0.5">{voiceErr}
            <button className="ml-1.5 underline opacity-60" onClick={() => { setVoiceErr(null); setVoiceStatus('idle'); }}>dismiss</button>
          </p>
        )}
        <div className="flex gap-2">
          {/* Mic button */}
          <button
            title={
              voiceStatus === 'recording' ? 'Stop recording · Ctrl+Shift+V' :
              voiceStatus === 'transcribing' ? 'Transcribing…' :
              'Start voice input · Ctrl+Shift+V'
            }
            onClick={handleMicClick}
            disabled={voiceStatus === 'transcribing'}
            className={`self-end p-1.5 rounded-lg border transition-fast shrink-0 ${
              voiceStatus === 'recording'
                ? 'border-red-500/60 bg-red-500/10 text-red-400 animate-pulse'
                : voiceStatus === 'transcribing'
                ? 'border-nv-border opacity-50 text-nv-faint cursor-not-allowed'
                : 'border-nv-border text-nv-muted hover:border-accent hover:text-accent'
            }`}
          >
            {voiceStatus === 'recording' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            ) : voiceStatus === 'transcribing' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" opacity=".3"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" className="animate-spin origin-center"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={voiceStatus === 'recording' ? 'Listening… click mic or Ctrl+Shift+V to stop' : 'Ask about your code… (Shift+Enter for newline)'}
            rows={2}
            className="flex-1 bg-nv-bg border border-nv-border rounded-lg px-2.5 py-1.5
              text-[11px] text-nv-text outline-none focus:border-accent transition-fast
              resize-none placeholder:text-nv-faint"
          />
          {busy ? (
            <button
              onClick={stop}
              className="self-end text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-red/50
                text-nv-red hover:bg-nv-red/10 transition-fast"
            >Stop</button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="self-end text-[11px] px-2.5 py-1.5 rounded-lg bg-accent text-white
                hover:bg-accent-dim transition-fast disabled:opacity-40"
            >Send</button>
          )}
        </div>
      </div>
    </div>
    {showVoiceUpgrade && (
      <UpgradeModal
        onClose={() => setShowVoiceUpgrade(false)}
        currentPlan={profile?.plan ?? 'explore'}
        highlightPlan="builder"
        reason="Voice to Code requires Builder plan or higher."
      />
    )}
    {showQuotaUpgrade && (
      <UpgradeModal
        onClose={() => setShowQuotaUpgrade(false)}
        currentPlan={profile?.plan ?? 'explore'}
        highlightPlan="solo"
        reason="You've used all your AI tasks for this period. Upgrade to continue."
      />
    )}
    </>
  );
}
