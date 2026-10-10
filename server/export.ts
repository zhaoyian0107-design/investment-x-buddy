import type { Project, Evidence, SourceSnapshot } from '../shared/types.ts';
import type { EvidenceBundle } from '../shared/bundle.ts';
import { contentHash } from './evidence.ts';
export { verifyBundle } from '../shared/bundle.ts';
export function exportBundle(
  p: Project,
  evidence: Evidence[],
  snapshots: SourceSnapshot[],
): EvidenceBundle {
  const report = p.report;
  const audit = {
    plan: p.plan,
    budget: p.budget,
    approvals: p.approvals,
    calls: p.calls,
    counterChecks: p.counterChecks,
    claimRevisions: p.claimRevisions,
    context: p.context,
  };
  return {
    format: 'x-buddy-evidence-v2',
    createdAt: new Date().toISOString(),
    project: {
      id: p.id,
      title: p.title,
      planVersion: p.plan.version,
      asOf: p.plan.asOf,
      dataMode: p.dataMode,
    },
    report,
    completion: p.completion,
    audit,
    evidence,
    snapshots,
    manifest: {
      reportHash: contentHash(report ?? null),
      evidenceHash: contentHash(evidence),
      snapshotsHash: contentHash(snapshots),
      researchHash: contentHash({ audit, completion: p.completion }),
    },
  };
}
