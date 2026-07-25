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
    advancedDeck:     true,
    socialScheduling: true,
    researchParallelism: 200,
    imageUnits:       null,   // negotiated plan — no cap.
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as Plan] ?? PLAN_CONFIG.free;
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
