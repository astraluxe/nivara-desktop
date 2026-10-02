// BACKUP of the live `automation-cloud-runner` Edge Function (version 16, verify_jwt: FALSE), saved
// 2 Oct 2026 before it was replaced by a "retired" stub. It was called every 5 minutes by pg_cron
// job 2 and ran users' cloud automations on adris.tech's GEMINI_API_KEY. To restore: redeploy this
// file and re-create the cron job (select cron.schedule(... 'automation-cloud-runner' ...)).
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPA_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SUPA_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// PC considered online if it pinged within the last 10 minutes
const PC_ONLINE_THRESHOLD_MS = 10 * 60 * 1000;

interface AutomationRow {
  id: string;
  user_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: Step[];
  run_count: number;
  last_run_at: string | null;
}

interface Step {
  action: string;
  prompt: string;
  output: string;
  output_config?: Record<string, unknown>;
}

interface Integration {
  service: string;
  access_token: string;
  refresh_token?: string;
  extra_data?: Record<string, unknown>;
  account_name?: string;
}

Deno.serve(async (_req) => {
  const db = createClient(SUPA_URL, SUPA_SRK);
  const now = new Date();

  const { data: automations, error } = await db
    .from("automations")
    .select("*")
    .eq("cloud_enabled", true)
    .eq("enabled", true)
    .eq("trigger_type", "schedule");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: Array<{ id: string; name: string; status: string; error?: string }> = [];

  // Group automations by user to batch heartbeat lookups
  const userIds = [...new Set((automations ?? []).map((a: AutomationRow) => a.user_id))];
  const { data: users } = await db
    .from("users")
    .select("id,last_desktop_ping")
    .in("id", userIds);

  const pingMap: Record<string, string | null> = {};
  for (const u of (users ?? []) as Array<{ id: string; last_desktop_ping: string | null }>) {
    pingMap[u.id] = u.last_desktop_ping;
  }

  for (const auto of (automations ?? []) as AutomationRow[]) {
    // Skip if desktop is online — local Rust handles it
    const lastPing = pingMap[auto.user_id];
    if (lastPing) {
      const pingAge = now.getTime() - new Date(lastPing).getTime();
      if (pingAge < PC_ONLINE_THRESHOLD_MS) {
        results.push({ id: auto.id, name: auto.name, status: "skipped_pc_online" });
        continue;
      }
    }

    const cron = (auto.trigger_config as Record<string, string>)?.cron;
    if (!cron || !isDue(cron, auto.last_run_at, now)) continue;

    const { data: integrations } = await db
      .from("user_integrations")
      .select("service,access_token,refresh_token,extra_data,account_name")
      .eq("user_id", auto.user_id);

    const creds: Record<string, Integration> = {};
    for (const i of (integrations ?? []) as Integration[]) {
      creds[i.service] = i;
    }

    const { data: runData } = await db
      .from("automation_runs")
      .insert({ automation_id: auto.id, user_id: auto.user_id, status: "running" })
      .select("id")
      .single();
    const runId = runData?.id as string | undefined;

    try {
      let context = `Today is ${now.toDateString()}. Automation: ${auto.name}.`;
      let finalOutput = "";

      for (const step of auto.steps) {
        const content = await callGemini(context, step.prompt);
        context = content;
        finalOutput = content;
        await deliverOutput(step.output, step.output_config ?? {}, content, creds);
      }

      if (runId) {
        await db.from("automation_runs").update({
          status: "done",
          completed_at: new Date().toISOString(),
          output_summary: finalOutput.slice(0, 500),
        }).eq("id", runId);
      }
      await db.from("automations").update({
        last_run_at: now.toISOString(),
        run_count: (auto.run_count || 0) + 1,
      }).eq("id", auto.id);

      results.push({ id: auto.id, name: auto.name, status: "ok" });
    } catch (e) {
      if (runId) {
        await db.from("automation_runs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: String(e),
        }).eq("id", runId);
      }
      results.push({ id: auto.id, name: auto.name, status: "error", error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ran: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

function isDue(cron: string, lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  const diffMs = now.getTime() - last.getTime();
  const parts = cron.trim().split(/\s+/);
  const hourF = parts[1] ?? "*";
  const dowF  = parts[4] ?? "*";
  if (hourF === "*")         return diffMs > 50 * 60 * 1000;
  if (dowF !== "*")          return diffMs > 6.5 * 24 * 60 * 60 * 1000;
  return                            diffMs > 23  * 60 * 60 * 1000;
}

async function callGemini(context: string, prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${context}\n\n${prompt}` }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 800 },
      }),
    }
  );
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function deliverOutput(
  type: string,
  cfg: Record<string, unknown>,
  content: string,
  creds: Record<string, Integration>,
): Promise<void> {
  if (type === "linkedin_post") {
    const li = creds["linkedin"];
    if (!li?.access_token) throw new Error("LinkedIn not connected for cloud");
    const personUrn = (li.extra_data?.person_urn ?? li.account_name ?? "") as string;
    const vis = (cfg.linkedinVisibility ?? cfg.linkedin_visibility ?? "PUBLIC") as string;
    const r = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${li.access_token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: personUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": vis },
      }),
    });
    if (!r.ok) throw new Error(`LinkedIn: ${await r.text()}`);
    return;
  }

  if (type === "twitter_post") {
    const tw = creds["twitter"];
    if (!tw?.access_token) throw new Error("X not connected for cloud");
    const keys = JSON.parse(tw.access_token) as {
      consumer_key: string; consumer_secret: string;
      access_token: string; access_token_secret: string;
    };
    const authHeader = await buildOAuth1Header("POST", "https://api.twitter.com/2/tweets", {}, keys);
    const r = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ text: content.slice(0, 280) }),
    });
    if (!r.ok) throw new Error(`X: ${await r.text()}`);
    return;
  }

  if (type === "notion") {
    const n = creds["notion"];
    if (!n?.access_token) throw new Error("Notion not connected for cloud");
    const url = (cfg.notionUrl ?? cfg.notion_db_url ?? "") as string;
    const dbId = url.split("/").pop()?.split("?")[0]?.replace(/-/g, "") ?? "";
    const r = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${n.access_token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: { title: { title: [{ text: { content: content.slice(0, 100) } }] } },
        children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content } }] } }],
      }),
    });
    if (!r.ok) throw new Error(`Notion: ${await r.text()}`);
    return;
  }

  if (type === "slack") {
    const sl = creds["slack"];
    if (!sl?.access_token) throw new Error("Slack not connected for cloud");
    const channel = `#${(cfg.slackChannel ?? cfg.slack_channel ?? "general") as string}`;
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${sl.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text: content }),
    });
    if (!r.ok) throw new Error(`Slack: ${await r.text()}`);
    return;
  }

  if (type === "discord") {
    const webhookUrl = (cfg.discordWebhook ?? creds["discord"]?.access_token ?? "") as string;
    if (!webhookUrl) throw new Error("Discord webhook not configured");
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!r.ok) throw new Error(`Discord: ${await r.text()}`);
    return;
  }

  if (type === "telegram") {
    const tg = creds["telegram"];
    if (!tg?.access_token) throw new Error("Telegram not connected for cloud");
    const chatId = (cfg.telegramChatId ?? cfg.telegram_chat_id ?? "") as string;
    const r = await fetch(`https://api.telegram.org/bot${tg.access_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: content }),
    });
    if (!r.ok) throw new Error(`Telegram: ${await r.text()}`);
  }
  // notification / file — local-only, silently skip in cloud mode
}

async function buildOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  keys: { consumer_key: string; consumer_secret: string; access_token: string; access_token_secret: string },
): Promise<string> {
  const nonce     = crypto.randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     keys.consumer_key,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        timestamp,
    oauth_token:            keys.access_token,
    oauth_version:          "1.0",
  };
  const allParams    = { ...params, ...oauthParams };
  const sortedParams = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join("&");
  const signingKey = `${encodeURIComponent(keys.consumer_secret)}&${encodeURIComponent(keys.access_token_secret)}`;
  const enc        = new TextEncoder();
  const cryptoKey  = await crypto.subtle.importKey(
    "raw", enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(baseString));
  oauthParams.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return "OAuth " + Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=\"${encodeURIComponent(v)}\"`)
    .join(", ");
}
