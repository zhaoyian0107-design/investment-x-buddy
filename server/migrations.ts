import type { Project } from '../shared/types.ts';
export function migrateProject(p: Project): Project {
  if (p.schemaVersion === 2) return p;
  p.schemaVersion = 2;
  p.legacy = true;
  p.legacyUsage = structuredClone(p.usage);
  p.ledgerBaseUsage = {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    elapsedMs: 0,
    unknownUsageCalls: 0,
  };
  p.usage = { ...p.ledgerBaseUsage };
  p.calls = [];
  p.planningAllowance = 0;
  p.approvals.forEach((a) => (a.status = 'rejected'));
  if (p.status === 'running') p.status = 'paused';
  if (p.report)
    p.report.validation = {
      referencesValid: 'not_checked',
      calculationChecked: 'not_checked',
      complianceChecked: 'not_checked',
      semanticSupport: 'needs_review',
      removedClaims: 0,
    };
  p.events.push({
    id: p.nextEventId++,
    at: new Date().toISOString(),
    type: 'schema.migrated',
    message: '历史成果已保留；旧授权失效、旧用量单独保留，重新研究需确认新计划。',
  });
  return p;
}
