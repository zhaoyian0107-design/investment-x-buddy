import { createHash } from 'node:crypto';
import { canonical } from '../shared/canonical.ts';
import type { Evidence, SourceSnapshot } from '../shared/types.ts';
export const contentHash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function sealEvidence(e: Evidence, planVersion = 1): Evidence {
  const { id: oldId, contentHash: oldHash, ...body } = e;
  const snapshotHash = contentHash(e.raw);
  const payload = { ...body, planVersion, snapshotId: `src-${snapshotHash}`, snapshotHash };
  const hash = contentHash(payload);
  return { ...payload, id: `e2-${hash}`, contentHash: hash };
}
export function evidenceSnapshot(projectId: string, e: Evidence): SourceSnapshot {
  return {
    id: e.snapshotId || `src-${contentHash(e.raw)}`,
    projectId,
    hash: e.snapshotHash || contentHash(e.raw),
    body: e.raw,
    capturedAt: e.retrievedAt,
    source: e.source,
    sourceRecordId: e.sourceRecordId,
    mode: e.mode,
  };
}
export function findField(evidence: Evidence[], entity: string, year: number, field: string) {
  return evidence.find((e) => e.entity === entity && e.year === year && e.field === field);
}
