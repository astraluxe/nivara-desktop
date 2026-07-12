// ─── Social posting: connections + scheduled-post queue ──────────────────────
// Delivery is handled server-side by the `social-dispatch` Edge Function + a
// per-minute Supabase cron sweep. This module is the thin client: manage the
// user's connected channels and enqueue/scheduling posts. No platform OAuth —
// users connect a posting webhook (Make/Zapier/n8n/Postiz) and/or Discord/Slack/
// Telegram, all of which need nothing but a URL/token they paste in.
import { supabase } from './supabase';

const DISPATCH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-dispatch`;

export type SocialChannel = 'webhook' | 'discord' | 'slack' | 'telegram';

export interface ChannelMeta { id: SocialChannel; name: string; hint: string; fields: { key: string; label: string; placeholder: string }[] }

export const CHANNEL_META: ChannelMeta[] = [
  { id: 'webhook',  name: 'Posting webhook', hint: 'Reaches all 15+ platforms via your Make / Zapier / n8n / Postiz automation.',
    fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://hook.make.com/…' }] },
  { id: 'discord',  name: 'Discord', hint: 'A channel webhook URL (Server Settings → Integrations → Webhooks).',
    fields: [{ key: 'url', label: 'Discord webhook URL', placeholder: 'https://discord.com/api/webhooks/…' }] },
  { id: 'slack',    name: 'Slack', hint: 'An incoming webhook URL for the channel you want to post to.',
    fields: [{ key: 'url', label: 'Slack webhook URL', placeholder: 'https://hooks.slack.com/services/…' }] },
  { id: 'telegram', name: 'Telegram', hint: 'A bot token (from @BotFather) and the chat/channel id to post to.',
    fields: [{ key: 'token', label: 'Bot token', placeholder: '123456:ABC-DEF…' }, { key: 'chat_id', label: 'Chat / channel id', placeholder: '@mychannel or -100…' }] },
];

export interface SocialConnection { id: string; channel: SocialChannel; config: Record<string, string>; label?: string }

export interface PostContent { text?: string; perPlatform?: Record<string, string> }

export async function listConnections(): Promise<SocialConnection[]> {
  const { data, error } = await supabase.from('social_connections').select('id, channel, config, label').order('created_at');
  if (error) return [];
  return (data as SocialConnection[]) ?? [];
}

export async function saveConnection(channel: SocialChannel, config: Record<string, string>, label?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) throw new Error('Sign in to connect a posting channel.');
  const { error } = await supabase.from('social_connections')
    .upsert({ user_id, channel, config, label: label ?? null }, { onConflict: 'user_id,channel' });
  if (error) throw new Error(error.message);
}

export async function deleteConnection(channel: SocialChannel): Promise<void> {
  await supabase.from('social_connections').delete().eq('channel', channel);
}

// Enqueue a post. scheduledAt in the future → the cron sweep sends it then.
export async function schedulePost(p: { platforms: string[]; content: PostContent; title?: string; scheduledAt: Date }): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) throw new Error('Sign in to schedule a post.');
  const { data, error } = await supabase.from('social_scheduled_posts')
    .insert({ user_id, platforms: p.platforms, content: p.content, title: p.title ?? null, scheduled_at: p.scheduledAt.toISOString(), status: 'pending' })
    .select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// Post immediately: enqueue at now(), then poke the dispatcher for just this post.
export async function postNow(p: { platforms: string[]; content: PostContent; title?: string }): Promise<{ id: string }> {
  const id = await schedulePost({ ...p, scheduledAt: new Date(Date.now() - 1000) });
  const { data: s } = await supabase.auth.getSession();
  const token = s?.session?.access_token;
  try {
    await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ postId: id }),
    });
  } catch { /* the cron sweep will still pick it up within a minute */ }
  return { id };
}

export async function getPostStatus(id: string): Promise<{ status: string; result: Record<string, string> } | null> {
  const { data } = await supabase.from('social_scheduled_posts').select('status, result').eq('id', id).single();
  return (data as { status: string; result: Record<string, string> }) ?? null;
}
