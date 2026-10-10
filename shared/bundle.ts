import { createHash } from 'node:crypto';
import { canonical } from './canonical.ts';
import type { Evidence, SourceSnapshot, Report, CompletionEvaluation, Project } from './types.ts';
export interface EvidenceBundle {
  format: 'x-buddy-evidence-v2';
  createdAt: string;
  project: { id: string; title: string; planVersion: number; asOf: string; dataMode: string };
  report?: Report;
  completion?: CompletionEvaluation;
  evidence: Evidence[];
  snapshots: SourceSnapshot[];
  audit: {
    plan: Project['plan'];
    budget: Project['budget'];
    approvals: Project['approvals'];
    calls: Project['calls'];
    counterChecks: Project['counterChecks'];
    claimRevisions: Project['claimRevisions'];
    context: Project['context'];
  };
  manifest: {
    reportHash: string;
    evidenceHash: string;
    snapshotsHash: string;
    researchHash: string;
  };
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export function verifyBundle(b: EvidenceBundle) {
  const errors: string[] = [];
  let calculations = 0;
  let legacyRecords = 0;
  let legacyCalculationsSkipped = 0;
  if (b.format !== 'x-buddy-evidence-v2') errors.push('证据包格式不支持');
  if (
    hash(b.report ?? null) !== b.manifest.reportHash ||
    hash(b.evidence) !== b.manifest.evidenceHash ||
    hash(b.snapshots) !== b.manifest.snapshotsHash
  )
    errors.push('证据包清单哈希不匹配');
  if (hash({ audit: b.audit, completion: b.completion }) !== b.manifest.researchHash)
    errors.push('研究过程清单哈希不匹配');
  const ids = new Map(b.evidence.map((e) => [e.id, e]));
  const snapshots = new Map(b.snapshots.map((s) => [s.id, s]));
  if (ids.size !== b.evidence.length) errors.push('证据身份重复');
  for (const s of b.snapshots) if (hash(s.body) !== s.hash) errors.push(`来源快照损坏：${s.id}`);
  for (const e of b.evidence) {
    if (e.contentHash) {
      const { id, contentHash, ...body } = e;
      if (hash(body) !== contentHash || id !== `e2-${contentHash}`)
        errors.push(`证据内容与身份不符：${id}`);
      const s = e.snapshotId ? snapshots.get(e.snapshotId) : undefined;
      if (
        !s ||
        s.projectId !== b.project.id ||
        s.hash !== e.snapshotHash ||
        hash(s.body) !== hash(e.raw)
      )
        errors.push(`来源快照引用缺失或不匹配：${id}`);
    } else legacyRecords++;
    if (e.type !== 'calculation') continue;
    if (!e.contentHash && !e.formulaKey) {
      legacyCalculationsSkipped++;
      continue;
    }
    calculations++;
    const inputs = e.inputIds.map((id) => ids.get(id));
    if (inputs.length !== 2 || inputs.some((x) => !x || x.value == null)) {
      errors.push(`计算缺少输入：${e.id}`);
      continue;
    }
    const [a, d] = inputs.map((e) => e!.value!);
    if (inputs.some((x) => x!.type !== 'field' || x!.entity !== e.entity || x!.unit !== 'CNY yuan'))
      errors.push(`计算对象或单位不匹配：${e.id}`);
    if (
      e.formulaKey === 'cash_conversion' &&
      (inputs[0]!.field !== 'operatingCashflow' ||
        inputs[1]!.field !== 'netProfit' ||
        inputs.some((x) => x!.year !== e.year))
    )
      errors.push(`现金利润比字段或期间不匹配：${e.id}`);
    if (
      e.formulaKey === 'growth' &&
      (inputs[0]!.field !== inputs[1]!.field ||
        inputs[0]!.year !== e.year ||
        inputs[1]!.year! >= e.year!)
    )
      errors.push(`变化率字段或期间不匹配：${e.id}`);
    const expected =
      d > 0
        ? e.formulaKey === 'cash_conversion'
          ? a / d
          : e.formulaKey === 'growth'
            ? (a - d) / d
            : NaN
        : null;
    if (
      expected === null
        ? e.value !== null
        : e.value == null ||
          !Number.isFinite(expected) ||
          Math.abs(e.value - expected) > Math.max(1, Math.abs(expected)) * 1e-10
    )
      errors.push(`计算结果不符：${e.id}`);
  }
  for (const c of b.report?.claims || [])
    for (const id of [...c.supportIds, ...c.counterIds])
      if (!ids.has(id)) errors.push(`判断引用不存在：${id}`);
  for (const c of b.audit?.counterChecks || [])
    for (const f of c.findings) {
      const e = ids.get(f.evidenceId);
      if (!e || e.type !== 'excerpt' || !String(e.raw).includes(f.quote))
        errors.push(`反证摘录不能定位：${f.evidenceId}`);
    }
  for (const r of b.audit?.claimRevisions || [])
    if (r.checkIds.some((id) => !b.audit.counterChecks?.some((c) => c.id === id)))
      errors.push(`判断修订缺少核查记录：${r.claimId}`);
  return {
    valid: errors.length === 0,
    calculations,
    evidenceRecords: b.evidence.length,
    legacyRecords,
    legacyCalculationsSkipped,
    errors,
    scope: '校验数据完整性、引用与算式；不证明原始材料真实性或金融解释正确',
  };
}
