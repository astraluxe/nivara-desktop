// ⚠️ STUB — pricing and token allocations not finalised.
// Change these numbers here only — all enforcement reads from this file.

export type Plan = 'explore' | 'solo' | 'growth' | 'builder' | 'pro' | 'custom';

export interface PlanConfig {
  /** Monthly token cap. null = unlimited or lifetime pool. */
  monthlyTokens: number | null;
  /** Human-readable label shown in UI. */
  label: string;
  /** Max simultaneous MCP connections. */
  mcpConnections: number;
  /** Can create mesh rooms (Phase 7). */
  canCreateMesh: boolean;
  /** Can join mesh rooms (Phase 7). */
  canJoinMesh: boolean;
  /** Max devices in mesh (Phase 7). */
  meshDevices: number;
  /** Can access Guard module (Phase 8). */
  guardAccess: boolean;
  /** Can use contract scanning in Guard (Phase 8). */
  contractScanning: boolean;
  /** Can export Guard audit trail (Phase 8). */
  auditExport: boolean;
  /** Can use Voice to Code (Phase 7). */
  voiceToCode: boolean;
  /** Can run cloud automations (Phase 4). */
  cloudAutomations: number;
}

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  explore: {
    monthlyTokens:   100_000,   // lifetime, not monthly
    label:           '100K lifetime',
    mcpConnections:  2,
    canCreateMesh:   false,
    canJoinMesh:     false,
    meshDevices:     0,
    guardAccess:     false,
    contractScanning:false,
    auditExport:     false,
    voiceToCode:     false,
    cloudAutomations:0,
  },
  solo: {
    monthlyTokens:   2_000_000,
    label:           '2M / month',
    mcpConnections:  5,
    canCreateMesh:   false,
    canJoinMesh:     false,
    meshDevices:     0,
    guardAccess:     false,
    contractScanning:false,
    auditExport:     false,
    voiceToCode:     false,
    cloudAutomations:20,
  },
  growth: {
    monthlyTokens:   2_000_000,
    label:           '2M / month',
    mcpConnections:  10,
    canCreateMesh:   false,
    canJoinMesh:     true,
    meshDevices:     3,
    guardAccess:     false,
    contractScanning:false,
    auditExport:     false,
    voiceToCode:     false,
    cloudAutomations:100,
  },
  builder: {
    monthlyTokens:   10_000_000,
    label:           '10M / month',
    mcpConnections:  25,
    canCreateMesh:   true,
    canJoinMesh:     true,
    meshDevices:     5,
    guardAccess:     true,
    contractScanning:true,
    auditExport:     false,
    voiceToCode:     true,
    cloudAutomations:500,
  },
  pro: {
    monthlyTokens:   null,
    label:           'Unlimited',
    mcpConnections:  999,
    canCreateMesh:   true,
    canJoinMesh:     true,
    meshDevices:     10,
    guardAccess:     true,
    contractScanning:true,
    auditExport:     true,
    voiceToCode:     true,
    cloudAutomations:999999,
  },
  custom: {
    monthlyTokens:   null,
    label:           'Custom',
    mcpConnections:  999,
    canCreateMesh:   true,
    canJoinMesh:     true,
    meshDevices:     10,
    guardAccess:     true,
    contractScanning:true,
    auditExport:     true,
    voiceToCode:     true,
    cloudAutomations:999999,
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as Plan] ?? PLAN_CONFIG.explore;
}

/** Rough character → token estimate (chars ÷ 4). */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
