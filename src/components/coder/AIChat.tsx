import { useState, useRef, useEffect, useCallback } from 'react';
import { streamAI, type ConnectionMode, type Provider, type AiMessage } from '../../lib/ai';
import { chatDb, type ChatSession, type ChatMessage } from '../../lib/chatDb';
import { trackTokenUsage } from '../../lib/tokenTracker';
import ConnectionBar from './ConnectionBar';
import PromptLibrary from './PromptLibrary';

interface Props {
  projectPath: string;
  currentFileContent: string;
  currentFilePath: string | null;
  getTerminalContext: () => string;
  onRunInTerminal: (cmd: string) => void;
  onInsertAtCursor: (text: string) => void;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function CodeBlock({ code, lang, onRun, onInsert }: {
  code: string; lang: string;
  onRun: (c: string) => void;
  onInsert: (c: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

function MessageBubble({ msg, onRun, onInsert }: {
  msg: DisplayMessage;
  onRun: (c: string) => void;
  onInsert: (c: string) => void;
}) {
  const isUser = msg.role === 'user';
  const parts = msg.content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[85%] ${isUser
        ? 'bg-accent/15 border border-accent/30 rounded-2xl rounded-tr-sm px-3 py-2'
        : 'text-nv-text'}`}>
        {isUser ? (
          <p className="text-[12px] text-nv-text">{msg.content}</p>
        ) : (
          <div className="text-[12px] leading-relaxed">
            {parts.map((part, i) => {
              if (part.startsWith('```')) {
                const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
                const lang = match?.[1] ?? '';
                const code = match?.[2] ?? part.slice(3, -3);
                return <CodeBlock key={i} code={code.trim()} lang={lang} onRun={onRun} onInsert={onInsert} />;
              }
              return part ? (
                <p key={i} className="text-nv-muted whitespace-pre-wrap mb-1">{part}</p>
              ) : null;
            })}
            {msg.streaming && (
              <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse ml-0.5 rounded-sm" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIChat({
  projectPath, currentFileContent, currentFilePath,
  getTerminalContext, onRunInTerminal, onInsertAtCursor,
}: Props) {
  const [mode, setMode]               = useState<ConnectionMode>('local');
  const [apiKey, setApiKey]           = useState('');
  const [provider, setProvider]       = useState<Provider>('openai');
  const [modelName, setModelName]     = useState('gpt-4o');
  const [baseUrl, setBaseUrl]         = useState('');
  const [localModel, setLocalModel]   = useState('llama3');
  const [messages, setMessages]       = useState<DisplayMessage[]>([]);
  const [input, setInput]             = useState('');
  const [busy, setBusy]               = useState(false);
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions]       = useState<ChatSession[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function buildContext(): string {
    const parts: string[] = [];
    if (currentFilePath) {
      parts.push(`Current file: ${currentFilePath}\n\`\`\`\n${currentFileContent.slice(0, 6000)}\n\`\`\``);
    }
    const term = getTerminalContext();
    if (term.trim()) parts.push(`Last terminal output:\n\`\`\`\n${term}\n\`\`\``);
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
    setInput('');
    setBusy(true);

    const ctx = buildContext();
    const userContent = ctx ? `${ctx}\n\n---\n${text}` : text;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    const sid = await ensureSession().catch(() => null);
    if (sid) chatDb.saveMessage(sid, 'user', text).catch(() => {});

    const history: AiMessage[] = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: 'user', content: userContent });

    let assistantText = '';
    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

    const cleanup = await streamAI({
      mode, messages: history, apiKey, provider, localModel, modelName, baseUrl,
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
          trackTokenUsage('coder', userContent.length + assistantText.length);
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
    const list = await chatDb.getSessions(projectPath || '/').catch(() => [] as ChatSession[]);
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
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-nv-border shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask about your code… (Shift+Enter for newline)"
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
  );
}
