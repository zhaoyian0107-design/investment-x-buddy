import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldEvidence, demoPlan, calculate, newProject, baseReport } from '../server/research.ts';
import { demoRows } from '../server/data.ts';
import { evidenceSnapshot } from '../server/evidence.ts';
test('相同报告期的数据刷新产生新的证据身份，旧证据保留原值', () => {
  const plan = demoPlan('研究美的集团', 'demo');
  const row = demoRows(plan.entities[0], plan.years)[0];
  const before = fieldEvidence(row).find((e) => e.field === 'revenue')!;
  const after = fieldEvidence({ ...row, revenue: 999e8 }).find((e) => e.field === 'revenue')!;
  assert.notEqual(before.id, after.id);
  assert.equal(before.value, 3500e8);
});
test('证据包可以独立复算，篡改数值会被校验拒绝', async () => {
  const { exportBundle, verifyBundle } = await import('../server/export.ts');
  const plan = demoPlan('研究美的集团的经营现金流', 'demo');
  const p = newProject('o', '研究美的集团', plan, 'demo', 'demo');
  p.evidence = demoRows(plan.entities[0], plan.years).flatMap(fieldEvidence);
  p.evidence.push(...calculate(plan, p.evidence).evidence);
  p.report = baseReport(p, 'demo');
  const bundle = exportBundle(p, p.evidence, [
    ...new Map(
      p.evidence.map((e) => {
        const s = evidenceSnapshot(p.id, e);
        return [s.id, s] as const;
      }),
    ).values(),
  ]);
  const result = verifyBundle(bundle);
  assert.equal(result.valid, true);
  assert.equal(result.calculations, 4);
  bundle.evidence.find((e) => e.field === 'netProfit' && e.year === 2024)!.value = 1;
  assert.equal(verifyBundle(bundle).valid, false);
});

test('证据包快照丢失时即使重新计算清单也不能通过', async () => {
  const { exportBundle, verifyBundle } = await import('../server/export.ts');
  const p = newProject('o', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
  p.evidence = demoRows(p.plan.entities[0], p.plan.years).flatMap(fieldEvidence);
  const bundle = exportBundle(p, p.evidence, []);
  assert.equal(verifyBundle(bundle).valid, false);
  assert.ok(verifyBundle(bundle).errors.some((e) => e.includes('快照引用')));
});
