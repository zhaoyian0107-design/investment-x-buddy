import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../server/engine.ts';
import { SqliteStore } from '../server/store.ts';
import { demoPlan, newProject } from '../server/research.ts';

test('预算扩展或状态恢复不能绕过失败的对象核对', async () => {
  const store = new SqliteStore(':memory:');
  const engine = new Engine(store);
  try {
    const goal = '比较美的集团与格力电器的经营现金流与利润';
    const p = newProject('test-owner', goal, demoPlan(goal, 'demo'), 'demo', 'demo');
    p.tasks.find((t) => t.tool === 'resolve_entities')!.status = 'failed';
    p.status = 'running';
    await store.save(p);
    await engine.tick();
    const blocked = (await store.get(p.id))!;
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.usage.toolCalls, 0);
    assert.equal(blocked.evidence.length, 0);
    assert.ok(
      blocked.tasks.filter((t) => t.tool === 'fetch_financials').every((t) => t.attempts === 0),
    );
    assert.ok(blocked.events.some((e) => e.type === 'run.blocked'));
  } finally {
    await engine.stop();
    await store.close();
  }
});
