import test from 'node:test';
import assert from 'node:assert/strict';
import {
  demoPlan,
  demoPlan as planFor,
  newProject,
  baseReport,
  fieldEvidence,
  verifyClaims,
  calculate,
} from '../server/research.ts';
import { demoRows } from '../server/data.ts';
test('引用有效不能放行中文数字和无依据确定性结论', () => {
  const plan = demoPlan('研究美的集团', 'demo');
  const evidence = demoRows(plan.entities[0], plan.years).flatMap(fieldEvidence);
  const claim = {
    id: 'bad',
    kind: 'inference' as const,
    text: '营业收入为九百九十九亿元，且已经证明经营质量领先。',
    supportIds: [evidence[0].id],
    counterIds: [],
    limitations: [],
    confidence: 'limited' as const,
    verified: false,
  };
  assert.equal(verifyClaims([claim], evidence).claims.length, 0);
});
