import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface Props {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: Props) {
  const { profile, user } = useAuth();
  const isPaid = profile != null && profile.plan !== "explore";
  const [tab, setTab] = useState<"suggest" | "report">("suggest");
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function switchTab(t: "suggest" | "report") {
    setTab(t);
    setSubmitted(false);
    setText("");
  }

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await supabase.from("feedback").insert({
        user_id: user?.id ?? null,
        email: profile?.email ?? user?.email ?? null,
        plan: profile?.plan ?? "explore",
        type: tab === "suggest" ? "suggestion" : "error",
        message: text.trim(),
      });
    } catch { /* silent — no response sent to user */ }
    setSubmitted(true);
    setSubmitting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-nv-surface border border-nv-border rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nv-border">
          <h2 className="text-nv-text font-semibold text-sm">Feedback</h2>
          <button
            onClick={onClose}
            className="text-nv-muted hover:text-nv-text transition-fast text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-nv-border">
          <button
            onClick={() => switchTab("suggest")}
            className={`flex-1 py-2.5 text-xs font-medium transition-fast ${
              tab === "suggest"
                ? "text-accent border-b-2 border-accent -mb-px"
                : "text-nv-muted hover:text-nv-text"
            }`}
          >
            Suggest
          </button>
          <button
            onClick={() => switchTab("report")}
            className={`flex-1 py-2.5 text-xs font-medium transition-fast ${
              tab === "report"
                ? "text-accent border-b-2 border-accent -mb-px"
                : "text-nv-muted hover:text-nv-text"
            }`}
          >
            Report Error
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {tab === "suggest" && !isPaid ? (
            /* Free user on Suggest tab */
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-accent/8 border border-accent/20 rounded-lg">
                <span className="text-accent mt-0.5 shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                </span>
                <div className="flex flex-col gap-1.5">
                  <p className="text-nv-text text-sm font-semibold leading-snug">
                    Suggestions are for paid members
                  </p>
                  <p className="text-nv-muted text-xs leading-relaxed">
                    We build for people who are serious about the tools they use.
                    Paid members help shape adris.tech — their voice carries real
                    weight because they've invested in the platform. Upgrade your
                    plan to suggest features directly to our team.
                  </p>
                </div>
              </div>
              <p className="text-nv-faint text-[11px] text-center">
                You can still report an error using the tab above.
              </p>
              <button
                onClick={() => switchTab("report")}
                className="w-full py-2 text-xs text-nv-muted border border-nv-border rounded-lg hover:bg-nv-surface2 transition-fast"
              >
                Go to Report Error
              </button>
            </div>
          ) : submitted ? (
            /* Success state */
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-10 h-10 rounded-full bg-nv-green/15 flex items-center justify-center">
                <svg
                  width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"
                  className="text-nv-green"
                >
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <p className="text-nv-text text-sm font-semibold">Received</p>
              <p className="text-nv-muted text-xs text-center leading-relaxed">
                Your {tab === "suggest" ? "suggestion" : "error report"} has been
                submitted. We review every one — thank you.
              </p>
            </div>
          ) : (
            /* Input form */
            <div className="flex flex-col gap-3">
              <p className="text-nv-muted text-xs leading-relaxed">
                {tab === "suggest"
                  ? "What would make adris.tech better for you? Be specific — we read every suggestion."
                  : "Describe the error you encountered. Be as detailed as possible."}
              </p>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={
                  tab === "suggest"
                    ? "I'd love to see…"
                    : "When I tried to… it showed…"
                }
                className="w-full h-28 px-3 py-2.5 bg-nv-bg border border-nv-border rounded-lg text-nv-text text-xs placeholder:text-nv-faint resize-none focus:outline-none focus:border-accent/50 transition-fast"
                autoFocus
              />
              <button
                onClick={handleSubmit}
                disabled={!text.trim() || submitting}
                className="w-full py-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-fast"
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
