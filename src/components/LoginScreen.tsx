import { useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type OAuthPayload = {
  code?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  error?: string | null;
};

export default function LoginScreen() {
  const { refreshSession } = useAuth();
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [oauthUrl, setOauthUrl] = useState("");
  const [copied, setCopied] = useState(false);
  // Lets the Cancel button tear down the in-flight OAuth listeners/timers
  const cancelRef = useRef<(() => void) | null>(null);

  function handleCancel() {
    cancelRef.current?.();
    cancelRef.current = null;
  }

  async function handleGoogleSignIn() {
    setError("");
    setOauthUrl("");
    setCopied(false);
    setGoogleLoading(true);
    cancelRef.current = null;

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          skipBrowserRedirect: true,
          redirectTo: "http://localhost:54321/callback",
        },
      });

      if (error || !data.url) {
        setError(error?.message ?? "Failed to start Google sign-in");
        setGoogleLoading(false);
        return;
      }

      let done = false;

      async function finish(payload: OAuthPayload) {
        if (done) return;
        done = true;
        cancelRef.current = null;
        clearTimeout(timeoutId);
        clearInterval(pollId);
        try { unlisten(); } catch {}

        if (payload.error) {
          setError(payload.error);
          setGoogleLoading(false);
          return;
        }

        if (payload.code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(payload.code);
          if (e) { setError(e.message); setGoogleLoading(false); }
          else { await refreshSession(); setGoogleLoading(false); }
        } else if (payload.access_token) {
          const { error: e } = await supabase.auth.setSession({
            access_token: payload.access_token,
            refresh_token: payload.refresh_token ?? "",
          });
          if (e) { setError(e.message); setGoogleLoading(false); }
          else { await refreshSession(); setGoogleLoading(false); }
        } else {
          setError("Sign-in incomplete. Please try again.");
          setGoogleLoading(false);
        }
      }

      // Primary: Tauri event fired by the server when it receives the callback
      const unlisten = await listen<string>("oauth_complete", async (event) => {
        try { await finish(JSON.parse(event.payload)); }
        catch { if (!done) { done = true; cancelRef.current = null; setError("Authentication failed. Please try again."); setGoogleLoading(false); } }
      });

      // Fallback: poll poll_oauth_code every 800 ms in case the event is dropped
      const pollId = setInterval(async () => {
        if (done) { clearInterval(pollId); return; }
        try {
          const raw = await invoke<string | null>("poll_oauth_code");
          if (raw) await finish(JSON.parse(raw));
        } catch {}
      }, 800);

      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true;
          cancelRef.current = null;
          clearInterval(pollId);
          try { unlisten(); } catch {}
          setError("Sign-in timed out. Please try again.");
          setGoogleLoading(false);
          setOauthUrl("");
        }
      }, 180_000);

      // Wire up cancel so the button can tear everything down cleanly
      cancelRef.current = () => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        clearInterval(pollId);
        try { unlisten(); } catch {}
        setGoogleLoading(false);
        setOauthUrl("");
      };

      // Start callback server (synchronous bind — port must be ready before user opens browser)
      try {
        await invoke("start_oauth_server");
      } catch (e: unknown) {
        done = true;
        cancelRef.current = null;
        clearTimeout(timeoutId);
        clearInterval(pollId);
        try { unlisten(); } catch {}
        setError(typeof e === "string" ? e : "Could not start sign-in server. Restart the app.");
        setGoogleLoading(false);
        return;
      }
      setOauthUrl(data.url);
      // Do NOT auto-open any browser — let user choose.
      // Auto-opening races: if the default browser completes OAuth first it shuts down
      // the TCP server, so any other browser then gets ERR_CONNECTION_REFUSED.

    } catch {
      setError("Something went wrong. Please try again.");
      setGoogleLoading(false);
    }
  }

  function handleTitleBarMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging();
  }

  return (
    <div className="flex flex-col h-full bg-nv-bg select-none relative">
      {/* Mesh background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" style={{ opacity: 0.06 }}>
        <svg viewBox="0 0 1600 900" fill="none" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', width: '100%', height: '100%', color: '#7C5CFF' }}>
          <g stroke="currentColor" strokeWidth="1" fill="none">
            <path d="M0 100 L160 80 L320 120 L480 70 L640 110 L800 60 L960 120 L1120 80 L1280 120 L1440 70 L1600 110"/>
            <path d="M0 260 L160 240 L320 280 L480 230 L640 270 L800 220 L960 280 L1120 240 L1280 280 L1440 230 L1600 270"/>
            <path d="M0 420 L160 400 L320 440 L480 390 L640 430 L800 380 L960 440 L1120 400 L1280 440 L1440 390 L1600 430"/>
            <path d="M0 580 L160 560 L320 600 L480 550 L640 590 L800 540 L960 600 L1120 560 L1280 600 L1440 550 L1600 590"/>
            <path d="M0 740 L160 720 L320 760 L480 710 L640 750 L800 700 L960 760 L1120 720 L1280 760 L1440 710 L1600 750"/>
            <path d="M0 100 L160 240 L320 120 L480 230 L640 110 L800 220 L960 120 L1120 240 L1280 120 L1440 230 L1600 110"/>
            <path d="M0 260 L160 400 L320 280 L480 390 L640 270 L800 380 L960 280 L1120 400 L1280 280 L1440 390 L1600 270"/>
            <path d="M0 420 L160 560 L320 440 L480 550 L640 430 L800 540 L960 440 L1120 560 L1280 440 L1440 550 L1600 430"/>
            <path d="M0 580 L160 720 L320 600 L480 710 L640 590 L800 700 L960 600 L1120 720 L1280 600 L1440 710 L1600 590"/>
          </g>
          <circle style={{ transformBox: 'fill-box' as const, transformOrigin: 'center', animation: 'nv-node-pulse 2.4s ease-out infinite' }} cx="320" cy="280" r="7" fill="#7C5CFF"/>
          <circle style={{ transformBox: 'fill-box' as const, transformOrigin: 'center', animation: 'nv-node-pulse 2.4s ease-out 0.9s infinite' }} cx="800" cy="380" r="7" fill="#7C5CFF"/>
          <circle style={{ transformBox: 'fill-box' as const, transformOrigin: 'center', animation: 'nv-node-pulse 2.4s ease-out 1.8s infinite' }} cx="1280" cy="440" r="7" fill="#7C5CFF"/>
        </svg>
      </div>

      {/* Title bar */}
      <div
        className="flex items-center justify-end h-10 px-2 shrink-0 cursor-default"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-0.5">
          <button
            onClick={async () => { try { await getCurrentWindow().minimize(); } catch {} }}
            aria-label="Minimize"
            className="w-8 h-8 flex items-center justify-center rounded text-nv-muted hover:bg-nv-surface2 transition-fast"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={async () => { try { await getCurrentWindow().hide(); } catch {} }}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded text-nv-muted hover:bg-nv-red hover:text-white transition-fast"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Login card */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[360px] px-6">
          {/* Logo */}
          <div className="flex flex-col items-center gap-4 mb-10">
            <svg width="44" height="40" viewBox="0 0 26 24" fill="none" aria-label="adris.tech">
              <path d="M2 4 L9 4 L15 12 L9 20 L2 20 L8 12 Z" fill="#7C5CFF" />
              <path d="M12 4 L19 4 L25 12 L19 20 L12 20 L18 12 Z" fill="#7C5CFF" opacity="0.6" />
            </svg>
            <div className="text-center">
              <h1 className="text-nv-text text-xl font-semibold tracking-tight">Sign in to adris.tech</h1>
              <p className="text-nv-muted text-sm mt-1">Use your Google / Gmail account</p>
            </div>
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full py-3 rounded-lg bg-nv-surface hover:bg-nv-surface2 disabled:opacity-50 border border-nv-border text-nv-text text-sm font-medium transition-fast flex items-center justify-center gap-3"
          >
            {googleLoading
              ? <><Spinner />{oauthUrl ? "Waiting for sign-in…" : "Starting…"}</>
              : <><GoogleIcon />Continue with Google</>}
          </button>

          {error && (
            <p className="mt-4 text-nv-red text-xs font-mono px-3 py-2 bg-nv-red/10 border border-nv-red/20 rounded-lg">
              {error}
            </p>
          )}

          {googleLoading && oauthUrl && (
            <div className="mt-4 space-y-2">
              {/* Primary action: open in whichever browser the user wants */}
              <button
                onClick={() => open(oauthUrl)}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 transition-colors flex items-center justify-center gap-2"
              >
                Open sign-in in browser →
              </button>

              {/* Divider */}
              <div className="relative flex items-center py-0.5">
                <div className="flex-1 h-px bg-nv-border"/>
                <span className="px-2 text-[10px] text-nv-faint">or</span>
                <div className="flex-1 h-px bg-nv-border"/>
              </div>

              {/* Secondary: copy for pasting in a specific browser */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(oauthUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="w-full text-[11px] px-3 py-2 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-colors"
              >
                {copied ? "✓ Copied!" : "Copy link — paste in your preferred browser"}
              </button>

              <p className="text-nv-faint text-[10px] text-center leading-relaxed pt-1">
                The app logs in automatically once you complete sign-in.
              </p>

              {/* Cancel — lets user restart without waiting for 3-min timeout */}
              <button
                onClick={handleCancel}
                className="w-full text-[10px] text-nv-faint hover:text-nv-muted transition-colors pt-1"
              >
                Cancel sign-in
              </button>
            </div>
          )}

          {googleLoading && !oauthUrl && (
            <p className="text-nv-faint text-[11px] text-center mt-4">
              Starting sign-in…
            </p>
          )}

          {!googleLoading && !error && (
            <p className="text-nv-faint text-[11px] text-center mt-6 leading-relaxed">
              Opens a sign-in page — choose which browser to use.<br/>Return to this app once done.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}
