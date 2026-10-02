export type Plan = 'explore' | 'free' | 'solo' | 'builder' | 'business' | 'custom';

export interface PlanConfig {
  monthlyTokens:      number | null; // null = unlimited; free plan uses as lifetime cap
  label:              string;
  mcpConnections:     number;
  researchParallelism: number;
  canCreateMesh:    boolean;       // relay nodes available (Builder+)
  canJoinMesh:      boolean;
  meshDevices:      number;        // max devices in a Mesh session
  guardAccess:      boolean;
  // ONE pool for everything Guard does — contract scans, phishing checks, compliance runs,
  // vulnerability briefings. Simpler to explain and to reason about than per-feature meters.
  // null = unlimited.
  guardChecks: number | null;
  contractScanning: boolean;
  auditExport:      boolean;
  voiceToCode:      boolean;
  cloudAutomations: number;        // monthly cloud automation run quota
  advancedSearches: number | null; // monthly "Advanced" (browser verify/enrich) task quota; null = unlimited
  // POWER COMMANDS ON A TRIAL. The heavy slash commands -- /leads, /outreach, /scan, /enrich,
  // /verify, /research -- are the ones worth paying for: each drives a long browser session and
  // is the actual product, not a chat reply. Metering them in TOKENS never bounded a trial,
  // because a free user on their own NVIDIA key spends none of ours; they could run lead-gen
  // forever for free. This is a straight run count, charged whatever the AI source, so
  // "bring your own key and try the whole thing" stays true without being unlimited.
  // null = unlimited.
  powerCommands: number | null;
  advancedDeck:     boolean;       // Advanced PPT maker (AI-image slides). Basic deck is available to all.
  socialScheduling: boolean;       // Schedule/publish social posts. Drafting is free for all; scheduling is paid.
  // AI images generated on OUR key, per billing period. null = unlimited.
  //
  // Why a separate cap at all: the token meter counts an image as a handful of tokens, but an
  // image costs 20–80x more MONEY than the same number of text tokens. Metered purely in tokens,
  // a Solo user could generate ~3,100 images inside their 4M allowance — about $120 of Google
  // spend on a ₹1,499 plan. The token charge below signals the cost; this cap bounds it.
  //
  // Images on the user's OWN key (NVIDIA FLUX / their own Gemini key) are free and never counted.
  imageUnits: number | null;
}

// One "image unit" is one standard (Nano Banana) image. Nano Banana Pro produces a better image
// for ~3.4x the price, so it costs 3.5 units — the cap is a budget, not an image count, which is
// what keeps the worst case bounded no matter which model is picked.
export const IMAGE_UNITS_PRO   = 3.5;
export const IMAGE_UNITS_FLASH = 1;

// Tokens charged per image unit. Chosen so images are visible in the meter (~10x the old flat
// 1,290) without swallowing the whole allowance — the cap above is what actually bounds the spend.
// Also the divisor that turns recorded image tokens back into units, so the two must stay in step
// with the Rust side (krew_generate_image in src-tauri/src/lib.rs).
export const TOKENS_PER_IMAGE_UNIT = 12_000;

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  explore: {
    monthlyTokens:    100_000,
    label:            '50 tasks · lifetime',
    mcpConnections:   2,
    canCreateMesh:    false,
    canJoinMesh:      true,
    meshDevices:      3,
    guardAccess:      false,
    guardChecks: null,       // unlimited
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 0,
    advancedSearches: 5,
    powerCommands:    15,     // a real trial of the heavy commands, on any key
    advancedDeck:     false,
    socialScheduling: false,
    researchParallelism: 5,
    imageUnits:       0,      // Advanced decks are paid-only, so there are no AI images to meter.
  },
  free: {
    monthlyTokens:    100_000,     // ~50 tasks at ~2K tokens each (lifetime cap)
    label:            '50 tasks · lifetime',
    mcpConnections:   2,
    canCreateMesh:    false,
    canJoinMesh:      true,
    meshDevices:      3,
    guardAccess:      false,
    guardChecks: null,       // unlimited
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 0,
    advancedSearches: 5,
    powerCommands:    15,     // a real trial of the heavy commands, on any key
    advancedDeck:     false,
    socialScheduling: false,
    researchParallelism: 5,
    imageUnits:       0,      // Advanced decks are paid-only, so there are no AI images to meter.
  },
  solo: {
    monthlyTokens:    4_000_000,   // ~4,000 tasks/month
    label:            '~4,000 tasks/mo',
    mcpConnections:   5,
    canCreateMesh:    false,
    canJoinMesh:      true,
    meshDevices:      10,
    guardAccess:      true,        // Solo gets Guard as a taste — 10 scans/month
    guardChecks: 50,         // Solo: 50 Guard checks a month, any mix of features
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 500,
    advancedSearches: null,   // paid → unlimited Advanced (the upgrade incentive for Free users)
    powerCommands:    null,
    advancedDeck:     true,
    socialScheduling: true,
    researchParallelism: 15,
    imageUnits:       70,     // ~$2.70 of image spend at worst — about 20% of net revenue.
  },
  builder: {
    monthlyTokens:    16_000_000,  // ~16,000 tasks/month
    label:            '~16,000 tasks/mo',
    mcpConnections:   25,
    canCreateMesh:    true,        // relay nodes unlocked
    canJoinMesh:      true,
    meshDevices:      25,
    guardAccess:      true,
    guardChecks: null,       // unlimited
    contractScanning: true,
    auditExport:      false,
    voiceToCode:      true,
    cloudAutomations: 5_000,
    advancedSearches: null,   // paid → unlimited Advanced
    powerCommands:    null,
    advancedDeck:     true,
    socialScheduling: true,
    researchParallelism: 40,
    imageUnits:       235,    // ~$9.20 at worst.
  },
  business: {
    monthlyTokens:    50_000_000,  // ~50,000 tasks/month
    label:            '~50,000 tasks/mo',
    mcpConnections:   50,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      50,
    guardAccess:      true,
    guardChecks: null,       // unlimited
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999_999,
    advancedSearches: null,
    powerCommands:    null,
    advancedDeck:     true,
    socialScheduling: true,
    researchParallelism: 100,
    imageUnits:       940,    // ~$37 at worst.
  },
  custom: {
    monthlyTokens:    null,
    label:            'Unlimited',
    mcpConnections:   999,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      50,
    guardAccess:      true,
    guardChecks: null,       // unlimited
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999_999,
    advancedSearches: null,
    powerCommands:    null,
    advancedDeck:     true,
    socialScheduling: true,
    researchParallelism: 200,
    imageUnits:       null,   // negotiated plan — no cap.
  },
};

// ─── adris.tech IS FREE (Oct 2026) ───────────────────────────────────────────
//
// The hosted plan is retired: there is no adris.tech key, so nothing a user does in the app costs
// adris.tech anything — every answer runs on the user's own key, their Claude Code / Codex, or a
// local model. With no cost there is nothing to ration, so every account gets the same entitlement:
// everything on, no caps.
//
// Two numbers stay at zero because they would only ever have run on OUR money, and that path is
// switched off on the server too: cloud automation runs (the Edge Function that ran them used our
// Gemini key) — automations still run on the user's PC. AI images are uncapped because the only
// way left to make one is the user's own image key.
//
// PLAN_CONFIG above is kept as history and for code that still names a tier; nothing gates on it.
export const FREE_FOR_ALL: PlanConfig = {
  monthlyTokens:       null,    // null = unlimited — every reader checks `!== null` before capping
  label:               'Free',
  mcpConnections:      999,
  researchParallelism: 40,
  canCreateMesh:       true,
  canJoinMesh:         true,
  meshDevices:         50,
  guardAccess:         true,
  guardChecks:         null,
  contractScanning:    true,
  auditExport:         true,
  voiceToCode:         true,
  cloudAutomations:    0,       // retired — ran on our key. Automations run on the user's PC.
  advancedSearches:    null,
  powerCommands:       null,
  advancedDeck:        true,
  socialScheduling:    true,
  imageUnits:          null,    // only the user's own image key can make one now
};

export function getPlanConfig(_plan: string): PlanConfig {
  return FREE_FOR_ALL;
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * The plan a real ACCOUNT is entitled to, admin level included.
 *
 * `getPlanConfig` takes a plan string and knows nothing about who is holding it. Every screen that
 * shows the user their plan goes through `tierForAccount`, which promotes head and admin accounts
 * to enterprise — so the owner is DISPLAYED as Enterprise everywhere and was ENFORCED as whatever
 * their row happens to say. Theirs says `solo`, and solo has no voice input: clicking the
 * microphone in their own product opened an upgrade page.
 *
 * One entitlement, read the same way by what is shown and what is allowed.
 */
export function planConfigFor(
  _account: { plan?: string | null; admin_level?: string | null } | null | undefined,
): PlanConfig {
  // One entitlement for everyone — see FREE_FOR_ALL.
  return FREE_FOR_ALL;
}
