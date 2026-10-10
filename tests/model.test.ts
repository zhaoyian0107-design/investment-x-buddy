import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { config } from '../server/config.ts';
import { planGoal, synthesize } from '../server/model.ts';
import { demoPlan, newProject, fieldEvidence } from '../server/research.ts';
import { demoRows } from '../server/data.ts';
let mode: 'plan' | 'report' | 'badref' | 'fail' = 'plan';
let lastPayload: any;
const original = { ...config };
const goal = '比较美的集团与格力电器的经营质量';
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  lastPayload = JSON.parse(body);
  if (mode === 'fail') {
    res.writeHead(503);
    res.end('unavailable');
    return;
  }
  const value =
    mode === 'plan'
      ? demoPlan(goal, 'demo')
      : {
          summary: '当前证据支持局部比较，完整经营质量仍需审阅。',
          interpretations: [
            {
              kind: 'inference',
              text: '现金支撑仅是研究的一个观察维度。',
              supportIds: [
                mode === 'badref'
                  ? 'invented'
                  : JSON.parse(lastPayload.input).evidence.find(
                      (e: any) => e.year === 2024 && e.field === 'netProfit',
                    ).id,
              ],
              counterIds: [],
              limitations: ['可比性尚未核查'],
              confidence: 'limited',
            },
          ],
          nextQuestions: ['进一步核查营运资本变化。'],
        };
  if (mode === 'plan') {
    const { version, question, ...plan } = value as any;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(plan) }] }],
        usage: { input_tokens: 30, output_tokens: 20 },
      }),
    );
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
        usage: { input_tokens: 30, output_tokens: 20 },
      }),
    );
  }
});
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as any;
  Object.assign(config, {
    modelMode: 'live',
    modelBase: `http://127.0.0.1:${address.port}`,
    modelStyle: 'responses',
    modelKey: 'protocol-test-only',
    model: 'mock-model',
    inputRate: '1',
    outputRate: '2',
  });
});
after(async () => {
  Object.assign(config, original);
  await new Promise<void>((r) => server.close(() => r()));
});
test('真实接口路径使用Responses严格结构化输出，保存供应商usage', async () => {
  mode = 'plan';
  const result = await planGoal(goal, 'demo', []);
  assert.equal(result.mode, 'live');
  assert.equal(result.usage!.inputTokens, 30);
  assert.equal(lastPayload.store, false);
  assert.equal(lastPayload.text.format.strict, true);
  assert.equal(result.usage!.costUsd, (30 + 40) / 1e6);
});
test('模型解释只接受已有证据，不生成财务数字事实', async () => {
  mode = 'report';
  const p = newProject('o', goal, demoPlan(goal, 'demo'), 'demo', 'live');
  p.evidence = demoRows(p.plan.entities[0], p.plan.years).flatMap(fieldEvidence);
  const report = await synthesize(p);
  assert.equal(report.modelMode, 'live');
  assert.equal(p.usage.modelCalls, 1);
  assert.ok(report.claims.some((c) => c.kind === 'inference'));
  assert.equal(p.usage.unknownUsageCalls, 0);
});
test('模型虚构的证据ID被剔除，模型调用只统计一次', async () => {
  mode = 'badref';
  const p = newProject('o', goal, demoPlan(goal, 'demo'), 'demo', 'live');
  p.evidence = demoRows(p.plan.entities[0], p.plan.years).flatMap(fieldEvidence);
  const report = await synthesize(p);
  assert.equal(report.validation.removedClaims, 1);
  assert.ok(report.claims.every((c) => c.kind === 'fact' || c.core));
  assert.ok(report.claims.every((c) => !c.supportIds.includes('invented')));
  assert.equal(p.usage.modelCalls, 1);
});
test('模型HTTP失败返回明确fallback，并记录未知用量', async () => {
  mode = 'fail';
  const p = newProject('o', goal, demoPlan(goal, 'demo'), 'demo', 'live');
  const report = await synthesize(p);
  assert.equal(report.modelMode, 'fallback');
  assert.equal(p.usage.modelCalls, 1);
  assert.equal(p.usage.unknownUsageCalls, 1);
  assert.equal(p.usage.costUsd, null);
});
