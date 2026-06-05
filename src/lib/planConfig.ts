export type Plan = 'free' | 'solo' | 'builder' | 'business' | 'custom';

export interface PlanConfig {
  monthlyTokens:    number | null; // null = unlimited or lifetime pool
  label:            string;
  mcpConnections:   number;
  canCreateMesh:    boolean;
  canJoinMesh:      boolean;
  meshDevices:      number;
  guardAccess:      boolean;
  contractScanning: boolean;
  auditExport:      boolean;
  voiceToCode:      boolean;
  cloudAutomations: number;
}

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  free: {
    monthlyTokens:    100_000,  // lifetime, not monthly
    label:            '50 tasks lifetime',
    mcpConnections:   2,
    canCreateMesh:    false,
    canJoinMesh:      false,
    meshDevices:      0,
    guardAccess:      false,
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 0,
  },
  solo: {
    monthlyTokens:    5_000_000,
    label:            '5M / month',
    mcpConnections:   5,
    canCreateMesh:    false,
    canJoinMesh:      false,
    meshDevices:      0,
    guardAccess:      false,
    contractScanning: false,
    auditExport:      false,
    voiceToCode:      false,
    cloudAutomations: 20,
  },
  builder: {
    monthlyTokens:    22_000_000,
    label:            '22M / month',
    mcpConnections:   25,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      5,
    guardAccess:      true,
    contractScanning: true,
    auditExport:      false,
    voiceToCode:      true,
    cloudAutomations: 500,
  },
  business: {
    monthlyTokens:    62_000_000,
    label:            '62M / month',
    mcpConnections:   999,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      10,
    guardAccess:      true,
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999999,
  },
  custom: {
    monthlyTokens:    null,
    label:            'Unlimited',
    mcpConnections:   999,
    canCreateMesh:    true,
    canJoinMesh:      true,
    meshDevices:      10,
    guardAccess:      true,
    contractScanning: true,
    auditExport:      true,
    voiceToCode:      true,
    cloudAutomations: 999999,
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as Plan] ?? PLAN_CONFIG.free;
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
