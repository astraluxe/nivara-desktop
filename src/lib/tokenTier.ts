// ─── Budget-aware survival tiers ──────────────────────────────────────────────
// Adapted from the "survival tier" idea: instead of slamming into a hard wall at
// 100% of the plan's token budget, the agent gracefully degrades as the budget
// runs low — shedding non-essential work and staying concise so the user gets
// MORE done with the tasks they have left, and hits fewer dead-ends.
//
//   normal   (<80%)   full capability
//   saver    (80–95%) trim optional passes, prefer single-agent, fewer results
//   critical (95–100%) bare minimum, no workflows, one tool call, upgrade nudge
//   depleted (100%)   hard wall (handled by the existing quota-upgrade modal)

export type TokenTier = 'normal' | 'saver' | 'critical' | 'depleted';

const APPROX_TOKENS_PER_TASK = 1000; // plan labels use ~1K tokens ≈ 1 task

export function computeTokenTier(used: number, cap: number | null): TokenTier {
  if (cap === null || cap <= 0) return 'normal'; // unlimited plan
  const ratio = used / cap;
  if (ratio >= 1)    return 'depleted';
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.8)  return 'saver';
  return 'normal';
}

export function tasksRemaining(used: number, cap: number | null): number | null {
  if (cap === null || cap <= 0) return null;
  return Math.max(0, Math.floor((cap - used) / APPROX_TOKENS_PER_TASK));
}

/** Instruction appended to the agent system prompt so it sheds non-essential work. */
export function tokenTierDirective(tier: TokenTier): string {
  if (tier === 'saver') {
    return '\n\n## Budget saver mode (the user is past 80% of their plan\'s tasks for this period)\n'
      + 'Conserve tokens WITHOUT hurting the answer quality the user asked for:\n'
      + '- Prefer answering directly, or with a SINGLE specialist, over a multi-agent plan_workflow.\n'
      + '- Skip optional polish passes and "nice to have" extra research — do the core job, drop embellishments.\n'
      + '- Ask research/scrape tools for fewer results (5–8, not 15+).\n'
      + '- Keep your reply tight and skimmable. No filler, no restating the task back.';
  }
  if (tier === 'critical') {
    return '\n\n## Budget critical mode (the user has under 5% of their plan\'s tasks left)\n'
      + 'Do the minimum needed to satisfy the request: do NOT use plan_workflow, use at most ONE tool call, and answer as concisely as possible. '
      + 'End your reply with one short line: "You\'re almost out of tasks for this period — upgrade any time for more." Do not start any large or multi-step job.';
  }
  return '';
}

/** UI banner copy, or null when no warning is needed. */
export function tokenTierBanner(tier: TokenTier, remaining: number | null): { tone: 'warn' | 'crit'; text: string } | null {
  if (tier === 'saver') {
    return { tone: 'warn', text: `Saver mode — about ${remaining ?? 'a few'} tasks left this period. Krew is keeping replies tight to stretch them further.` };
  }
  if (tier === 'critical') {
    return { tone: 'crit', text: `Almost out — about ${remaining ?? 'a few'} tasks left. Krew is doing the essentials only. Upgrade any time for more.` };
  }
  return null;
}
