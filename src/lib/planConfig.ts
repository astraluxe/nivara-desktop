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
}

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
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as Plan] ?? PLAN_CONFIG.free;
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
