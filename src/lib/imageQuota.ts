import { supabase } from './supabase';
import { getPlanConfig, TOKENS_PER_IMAGE_UNIT, IMAGE_UNITS_PRO, IMAGE_UNITS_FLASH } from './planConfig';

// ─── AI image budget ─────────────────────────────────────────────────────────
// An image costs 20–80x more MONEY than the same count of text tokens, so the token meter alone
// never bounded it: a Solo user could generate thousands of images inside a 4M-token allowance.
// PlanConfig.imageUnits is that bound. One unit = one standard image; a Pro image costs 3.5.
//
// The count is read back from token_usage (task_type = 'krew_image') rather than kept locally, so
// it survives a reinstall and matches what the account was actually billed for. Images made on the
// user's OWN key (NVIDIA FLUX, their own Gemini key) never reach that table, so they never count —
// which is exactly the behaviour the "connect a free key" nudge is selling.

export const IMAGE_USAGE_TASK_TYPE = 'krew_image';

export interface ImageBudget {
  used: number;              // units spent this period
  cap: number | null;        // null = unlimited
  remaining: number | null;  // null = unlimited
  exhausted: boolean;
}

export function unitsForModel(model: string): number {
  return /pro/i.test(model) ? IMAGE_UNITS_PRO : IMAGE_UNITS_FLASH;
}

/**
 * Units already spent in the current billing period. Free/explore quotas are lifetime, mirroring
 * tokenTracker.getMonthlyUsage — the two must agree or the meters disagree with each other.
 */
export async function getImageUnitsUsed(plan: string): Promise<number> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return 0;

    let query = supabase
      .from('token_usage')
      .select('tokens_consumed')
      .eq('user_id', session.user.id)
      .eq('task_type', IMAGE_USAGE_TASK_TYPE);

    if (plan !== 'free' && plan !== 'explore') {
      const { data: prof } = await supabase
        .from('users').select('usage_period_start').eq('id', session.user.id).single();
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      query = query.gte('created_at', prof?.usage_period_start ?? monthStart.toISOString());
    }

    const { data, error } = await query;
    if (error) return 0;
    const tokens = (data ?? []).reduce((s: number, r: { tokens_consumed: number }) => s + (r.tokens_consumed ?? 0), 0);
    return tokens / TOKENS_PER_IMAGE_UNIT;
  } catch {
    return 0;
  }
}

export async function getImageBudget(plan: string): Promise<ImageBudget> {
  const cap = getPlanConfig(plan).imageUnits;
  const used = await getImageUnitsUsed(plan);
  if (cap === null) return { used, cap: null, remaining: null, exhausted: false };
  const remaining = Math.max(0, cap - used);
  return { used, cap, remaining, exhausted: remaining <= 0 };
}

/** Whole standard images still affordable — what the user actually wants to be told. */
export function imagesLeftLabel(b: ImageBudget): string {
  if (b.remaining === null) return 'unlimited';
  return String(Math.floor(b.remaining));
}
