import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../server/store.ts';
import { demoPlan, newProject } from '../server/research.ts';
import { approvalHash } from '../server/research.ts';
import { withCalls } from '../server/calls.ts';
import { fuyaoRequest } from '../server/data.ts';

test('调用预算预占是原子的，并发请求不能透支一次剩余预算', async () => {
  const s = new SqliteStore(':memory:');
  try {
    const p = newProject(
      'ledger-owner',
      '研究美的集团',
      demoPlan('研究美的集团', 'demo'),
      'demo',
      'demo',
    );
    p.budget.maxModelCalls = 1;
    const { approvalHash } = await import('../server/research.ts');
    p.approvals[0].planHash = approvalHash(p.plan, p.budget);
    p.approvals[0].status = 'approved';
    p.status = 'completed';
    await s.save(p);
    const input = {
      projectId: p.id,
      planVersion: 1,
      kind: 'model' as const,
      purpose: 'followup',
      mode: 'live' as const,
    };
    const outcomes = await Promise.allSettled([
      s.reserveCall({ ...input, key: 'a' }),
      s.reserveCall({ ...input, key: 'b' }),
    ]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await s.calls(p.id)).length, 1);
  } finally {
    await s.close();
  }
});

test('预占后计划改变，旧调用不能进入供应商边界', async () => {
  const s = new SqliteStore(':memory:');
  try {
    const p = newProject('owner', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
    p.status = 'completed';
    p.approvals[0].status = 'approved';
    await s.save(p);
    const c = await s.reserveCall({
      projectId: p.id,
      planVersion: 1,
      key: 'old',
      kind: 'model',
      purpose: 'followup',
      mode: 'live',
    });
    await s.update(p.id, (current) => {
      current.plan.version++;
      current.approvals[0].planVersion = current.plan.version;
      current.approvals[0].planHash = approvalHash(current.plan, current.budget);
    });
    await assert.rejects(s.startCall(c.id), /计划已变更/);
    assert.equal((await s.get(p.id))!.usage.modelCalls, 0);
  } finally {
    await s.close();
  }
});

test('已发生调用的费用独立于过期项目保存，重复键不能再次请求', async () => {
  const s = new SqliteStore(':memory:');
  try {
    const p = newProject('owner', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
    p.status = 'completed';
    p.approvals[0].status = 'approved';
    await s.save(p);
    const input = {
      projectId: p.id,
      planVersion: 1,
      key: 'paid-once',
      kind: 'model' as const,
      purpose: 'followup',
      mode: 'live' as const,
    };
    const c = await s.reserveCall(input);
    await s.startCall(c.id);
    await s.finishCall(c.id, {
      state: 'failed',
      usageKnown: true,
      inputTokens: 90,
      outputTokens: 30,
      costUsd: 0.001,
    });
    await s.save(p); // Deliberately writes a stale aggregate usage of zero.
    const current = (await s.get(p.id))!;
    assert.equal(current.usage.modelCalls, 1);
    assert.equal(current.usage.inputTokens, 90);
    assert.equal(current.usage.costUsd, 0.001);
    await assert.rejects(s.reserveCall(input), /已经处理/);
  } finally {
    await s.close();
  }
});

test('未发出的过期预占释放预算，原预占之后也不能发出', async () => {
  const s = new SqliteStore(':memory:');
  try {
    const p = newProject('owner', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
    p.budget.maxModelCalls = 1;
    p.status = 'completed';
    p.approvals[0].status = 'approved';
    p.approvals[0].planHash = approvalHash(p.plan, p.budget);
    await s.save(p);
    const input = {
      projectId: p.id,
      planVersion: 1,
      kind: 'model' as const,
      purpose: 'expiry',
      mode: 'live' as const,
    };
    const c = await s.reserveCall({ ...input, key: 'expired' });
    await s.finishCall(c.id, { reservedAt: new Date(Date.now() - 61000).toISOString() });
    await assert.rejects(s.startCall(c.id), /过期/);
    const second = await s.reserveCall({ ...input, key: 'current' });
    await s.startCall(second.id);
    assert.equal((await s.calls(p.id)).find((r) => r.id === c.id)!.state, 'released');
    assert.equal((await s.get(p.id))!.usage.modelCalls, 1);
  } finally {
    await s.close();
  }
});

test('缺少取数凭据时不发出请求，也不消耗外部调用预算', async () => {
  const s = new SqliteStore(':memory:');
  try {
    const p = newProject('owner', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
    p.status = 'completed';
    p.approvals[0].status = 'approved';
    await s.save(p);
    let sent = false;
    const transport = (async () => {
      sent = true;
      return new Response('{}');
    }) as typeof fetch;
    await assert.rejects(
      withCalls({ store: s, projectId: p.id, planVersion: 1, key: 'offline', mode: 'live' }, () =>
        fuyaoRequest('/api/test', {}, undefined, transport, ''),
      ),
      /未配置/,
    );
    assert.equal(sent, false);
    assert.equal((await s.calls(p.id)).length, 0);
  } finally {
    await s.close();
  }
});
