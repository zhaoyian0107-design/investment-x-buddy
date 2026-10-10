import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  demoPlan,
  newProject,
  fieldEvidence,
  calculate,
  compact,
  approvalHash,
  DEFAULT_BUDGET,
  verifyClaims,
  guardRequest,
  validatePlan,
  exportMarkdown,
  baseReport,
} from '../server/research.ts';
import { demoRows, validateRows, normalizeFuyao, fuyaoRequest } from '../server/data.ts';
import { SqliteStore, ConflictError } from '../server/store.ts';
const goal = '比较美的集团与格力电器的经营现金流与利润';
const plan = demoPlan(goal, 'demo');
test('自然语言规划按对象与指标变化，不接受未知演示数据', () => {
  assert.equal(demoPlan('研究海尔智家的经营质量', 'demo').entities.length, 1);
  assert.deepEqual(demoPlan('比较美的集团与格力电器，只看收入', 'demo').metrics, ['revenue']);
  assert.throws(() => demoPlan('研究美的集团2022年度经营质量', 'demo'), /构造样本/);
  assert.throws(() => validatePlan({ ...plan, entities: [] }, goal, 'demo'));
});
test('现金利润比来自原始元字段，保留两项输入依赖', () => {
  const fields = plan.entities.flatMap((e) => demoRows(e, plan.years).flatMap(fieldEvidence));
  const derived = calculate(plan, fields);
  const ratio = derived.evidence.find(
    (e) => e.entity === '美的集团' && e.year === 2024 && e.field === 'cashConversion',
  )!;
  assert.equal(ratio.value, 510 / 345);
  assert.equal(ratio.inputIds.length, 2);
  assert.equal(ratio.unit, '倍');
  const growth = derived.evidence.find(
    (e) => e.entity === '美的集团' && e.year === 2024 && e.field === 'netProfitGrowth',
  )!;
  assert.ok(Math.abs(growth.value! - (345 - 310) / 310) < 1e-12);
});
test('零／负分母不产生 Infinity、伪增长率或排名', () => {
  const rows = demoRows(plan.entities[0], plan.years);
  rows[0].netProfit = -1;
  rows[1].netProfit = 0;
  const result = calculate(plan, rows.flatMap(fieldEvidence));
  assert.equal(
    result.evidence.find((e) => e.year === 2024 && e.field === 'cashConversion')!.value,
    null,
  );
  assert.equal(
    result.evidence.find((e) => e.year === 2024 && e.field === 'netProfitGrowth')!.value,
    null,
  );
});
test('缺失字段显式产生缺口，不能补零', () => {
  const rows = demoRows(plan.entities[0], plan.years);
  rows[1].operatingCashflow = null;
  const result = calculate(plan, rows.flatMap(fieldEvidence));
  assert.ok(result.gaps.some((x) => x.includes('2024')));
  assert.equal(
    result.evidence.find((e) => e.year === 2024 && e.field === 'cashConversion'),
    undefined,
  );
});
test('数据源验证拒绝未来信息、错误对象、冲突期间和单位', () => {
  const entity = plan.entities[0];
  const rows = demoRows(entity, plan.years);
  assert.throws(
    () => validateRows(rows, entity, { ...plan, asOf: '2025-04-01' }, 'demo'),
    /未来信息/,
  );
  assert.throws(
    () =>
      validateRows(
        rows.map((r) => ({ ...r, publishedAt: '2025-04-19T16:00:00.000Z' })),
        entity,
        { ...plan, asOf: '2025-04-19' },
        'demo',
      ),
    /未来信息/,
  );
  assert.throws(() => validateRows([...rows, rows[0]], entity, plan, 'demo'), /冲突记录/);
  assert.throws(() =>
    validateRows(
      rows.map((r) => ({ ...r, unit: 'wan_yuan' })),
      entity,
      plan,
      'demo',
    ),
  );
  assert.throws(
    () =>
      validateRows(
        rows.map((r) => ({ ...r, code: 'wrong' })),
        entity,
        plan,
        'demo',
      ),
    /未授权对象/,
  );
  assert.throws(() => validateRows(rows, entity, plan, 'live'), /冒充真实数据/);
});
test('真实采集快照过期会阻止使用，年度报告年龄不当作过期', () => {
  const entity = plan.entities[0];
  const rows = demoRows(entity, plan.years).map((r) => ({
    ...r,
    mode: 'live' as const,
    retrievedAt: new Date(Date.now() - 90000000).toISOString(),
  }));
  assert.throws(() => validateRows(rows, entity, plan, 'live'), /过期/);
  rows.forEach((r) => (r.retrievedAt = new Date().toISOString()));
  assert.equal(validateRows(rows, entity, plan, 'live').length, 2);
});
test('扶摇直接适配保留原始字段，归母利润不会误用总净利润', () => {
  const single = { ...plan, years: [2024] };
  const metadata = {
    thscode: plan.entities[0].code,
    period: 'annual',
    fiscal_year: 2024,
    fiscal_period: 'FY',
    report_date_ms: Date.parse('2025-04-20'),
    period_end_ms: Date.parse('2024-12-31'),
    currency: 'CNY',
  };
  const rows = normalizeFuyao(
    plan.entities[0],
    single,
    [{ ...metadata, operating_income: 1000, parent_holder_net_profit: 90, net_profit: 100 }],
    [{ ...metadata, act_cash_flow_net: 110 }],
    ['income-id', 'cash-id'],
  );
  assert.equal(rows[0].netProfit, 90);
  assert.equal(rows[0].operatingCashflow, 110);
  assert.ok(rows[0].rawSource);
  assert.equal(rows[0].rawSource!.income.net_profit, 100);
  assert.ok(
    fieldEvidence(rows[0])
      .find((e) => e.field === 'operatingCashflow')!
      .sourceUrl!.includes('cash-flow-statements'),
  );
  assert.equal(validateRows(rows, plan.entities[0], single, 'live').length, 1);
});

test('扶摇响应快照保留原始信封、请求编号和额外字段', async () => {
  const body = JSON.stringify({
    code: 0,
    request_id: 'snapshot-test',
    data: { item: [{ extra_field: '保留原文', operating_income: 123.45678901234567 }] },
    extra_envelope: 'keep',
  });
  const transport = (async () => new Response(body, { status: 200 })) as typeof fetch;
  const response = await fuyaoRequest(
    '/api/test',
    { thscode: '000333.SZ' },
    undefined,
    transport,
    'test-only',
  );
  assert.equal(response.raw!.body, body);
  assert.equal(response.raw!.requestId, 'snapshot-test');
  assert.equal((response.items[0] as any).extra_field, '保留原文');
  assert.ok(!response.raw!.body.includes('test-only'));
});
test('扶摇 HTTP 200 的业务失败仍然必须被识别', async () => {
  const transport = (async () =>
    new Response(JSON.stringify({ code: 2003, message: 'no access', request_id: 'denied' }), {
      status: 200,
    })) as typeof fetch;
  await assert.rejects(
    fuyaoRequest('/api/test', {}, undefined, transport, 'test-key-not-real'),
    /业务错误 2003/,
  );
});
test('上下文压缩保留范围、原始证据编号和待核查问题', () => {
  const p = newProject('owner', goal, plan, 'demo', 'demo', ['优先现金流']);
  p.evidence = demoRows(plan.entities[0], plan.years).flatMap(fieldEvidence);
  p.gaps = ['原文尚未覆盖'];
  const summary = compact(p);
  assert.equal(summary.goal, goal);
  assert.ok(summary.constraints.includes('优先现金流'));
  assert.deepEqual(
    summary.evidenceIds,
    p.evidence.map((e) => e.id),
  );
  assert.ok(summary.openQuestions.includes('原文尚未覆盖'));
  assert.ok(summary.afterChars < summary.beforeChars);
});
test('审批绑定计划与预算，修改任一项改变授权指纹', () => {
  const original = approvalHash(plan, DEFAULT_BUDGET);
  assert.notEqual(original, approvalHash({ ...plan, version: 2 }, DEFAULT_BUDGET));
  assert.notEqual(original, approvalHash(plan, { ...DEFAULT_BUDGET, maxToolCalls: 13 }));
  const reordered = Object.fromEntries(Object.entries(plan).reverse()) as typeof plan;
  assert.equal(
    original,
    approvalHash(
      reordered,
      Object.fromEntries(Object.entries(DEFAULT_BUDGET).reverse()) as typeof DEFAULT_BUDGET,
    ),
  );
});
test('无效证据引用、模型新增数字和直接买卖建议被移除', () => {
  const evidence = demoRows(plan.entities[0], plan.years).flatMap(fieldEvidence);
  const claim = {
    id: 'c',
    kind: 'inference' as const,
    text: '当前只能建立局部观察。',
    supportIds: [evidence[0].id],
    counterIds: [],
    limitations: ['可比性需核查'],
    confidence: 'limited' as const,
    verified: false,
  };
  const result = verifyClaims(
    [
      claim,
      { ...claim, id: 'badref', supportIds: ['not-there'] },
      { ...claim, id: 'badnum', text: '利润增长99%' },
      { ...claim, id: 'trade', text: '建议买入' },
    ],
    evidence,
  );
  assert.equal(result.claims.length, 1);
  assert.equal(result.removed, 3);
  assert.throws(() => guardRequest('现在应该买入哪只股票'), /不提供/);
  assert.throws(() => guardRequest('给我一个仓位建议'), /不提供/);
});
test('导出保留构造样本标记和来源记录', () => {
  const p = newProject('owner', goal, plan, 'demo', 'demo');
  p.evidence = demoRows(plan.entities[0], plan.years).flatMap(fieldEvidence);
  p.report = baseReport(p, 'demo');
  const md = exportMarkdown(p);
  assert.match(md, /构造演示样本/);
  assert.match(md, /fixture:000333.SZ:2024/);
  assert.match(md, /原始字段|证据索引/);
});
test('SQLite 进程外持久化及乐观并发控制', async () => {
  mkdirSync(resolve('work'), { recursive: true });
  const folder = mkdtempSync(resolve('work/unit-'));
  const path = resolve(folder, 'test.sqlite');
  let store = new SqliteStore(path);
  const p = newProject('owner', goal, plan, 'demo', 'demo');
  await store.save(p);
  const a = (await store.get(p.id))!;
  const b = (await store.get(p.id))!;
  a.status = 'paused';
  await store.save(a);
  b.status = 'running';
  await assert.rejects(store.save(b), ConflictError);
  await store.close();
  store = new SqliteStore(path);
  assert.equal((await store.get(p.id))!.status, 'paused');
  assert.equal((await store.list('other')).length, 0);
  await store.close();
});
