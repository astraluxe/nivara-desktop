export type Plan = 'explore' | 'free' | 'solo' | 'builder' | 'business' | 'custom';

export interface PlanConfig {
  monthlyTokens:      number | null; // null = unlimited; free plan uses as lifetime cap
  label:              string;
  mcpConnections:     number;
  researchParallelism: number;
  canCreateMesh:    boolean;       // relay nodes available (Builder+)
  canJoinMesh:      boolean;
  meshDevices:      number;        // max devices in a Mesh session
  guardAccess:      boolean;       // Team plan only
  contractScanning: boolean;
  auditExport:      boolean;
  voiceToCode:      boolean;
  cloudAutomations: number;        // monthly cloud automation run quota
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
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 0,
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
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 0,
    researchParallelism: 5,
  },
  solo: {
    monthlyTokens:    2_000_000,   // ~2,000 tasks/month
    label:            '~2,000 tasks/mo',
    mcpConnections:   5,
    canCreateMesh:    false,
    canJoinMesh:      true,
    meshDevices:      10,
    guardAccess:      false,
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 500,
    researchParallelism: 15,
  },
  builder: {
    monthlyTokens:    8_000_000,   // ~8,000 tasks/month
    label:            '~8,000 tasks/mo',
    mcpConnections:   25,
    canCreateMesh:    true,        // relay nodes unlocked
    canJoinMesh:      true,
    meshDevices:      25,
    guardAccess:      true,        // Guard unlocked for Builder+
    contractScanning: true,
    auditExport:      false,
    voiceToCode:      true,
    cloudAutomations: 5_000,
    researchParallelism: 40,
  },
  business: {
    monthlyTokens:    30_000_000,  // ~30,000 tasks/month
    label:            '~30,000 tasks/mo',
    mcpConnections:   999,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      50,
    guardAccess:      true,
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999_999,
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
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999_999,
    researchParallelism: 200,
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as Plan] ?? PLAN_CONFIG.free;
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
