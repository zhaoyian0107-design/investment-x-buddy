import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyBundle } from '../shared/bundle.ts';
const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
assert.ok(base.startsWith('https://'), 'Use the actual HTTPS deployment.');
const session = JSON.parse(readFileSync('work/public-smoke-session.json', 'utf8'));
assert.equal(session.base, base);
async function request(path, body, expected = 200) {
  const r = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: session.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, expected, path);
  return r.json();
}
async function wait(id, statuses) {
  const deadline = Date.now() + 120000;
  let p;
  while (Date.now() < deadline) {
    p = await request('/projects/' + id);
    if (statuses.includes(p.status)) return p;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out at ' + p?.status);
}
const restart = process.argv.includes('--resume');
const output = 'outputs/public-resilience-result.json';
if (restart) {
  const before = JSON.parse(readFileSync('work/public-resilience-state.json', 'utf8'));
  const p = await request('/projects/' + before.projectId);
  assert.equal(p.status, 'paused');
  assert.deepEqual(
    p.checkpoints.map((c) => c.taskId),
    before.checkpointTaskIds,
  );
  await request('/projects/' + p.id + '/action', { action: 'resume' });
  const done = await wait(p.id, ['completed', 'partial', 'blocked', 'budget_exceeded']);
  assert.equal(done.status, 'completed');
  for (const task of before.committedTasks)
    assert.equal(
      done.tasks.find((t) => t.id === task.id).attempts,
      task.attempts,
      'Committed task must not be repeated.',
    );
  const verification = verifyBundle(await request('/projects/' + p.id + '/bundle'));
  assert.equal(verification.valid, true);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  result.afterRestart = {
    testedAt: new Date().toISOString(),
    projectId: p.id,
    status: done.status,
    reusedTasks: before.committedTasks.length,
    verification,
  };
  result.checks.push(
    'interrupted project survives cloud restart',
    'resume reuses committed tasks',
    'recovered evidence bundle verifies',
  );
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} else {
  const boot = await request('/bootstrap');
  assert.equal(boot.config.database.toLowerCase(), 'mysql');
  assert.equal(boot.config.faultLab, true);
  const stale = await request('/projects', { goal: boot.defaultGoal }, 201);
  await request('/projects/' + stale.id + '/fault', { fault: 'stale_data' });
  await request('/projects/' + stale.id + '/approve', { approvalId: stale.approvals[0].id });
  const degraded = await wait(stale.id, ['partial', 'blocked', 'completed', 'budget_exceeded']);
  assert.equal(degraded.status, 'partial');
  assert.ok(degraded.gaps.length > 0);
  assert.notEqual(degraded.completion?.outcome, 'met');
  const low = await request('/projects', { goal: boot.defaultGoal }, 201);
  await request('/projects/' + low.id + '/budget', {
    maxToolCalls: 1,
    maxModelCalls: 2,
    maxSeconds: 180,
  });
  await request('/projects/' + low.id + '/approve', { approvalId: low.approvals[0].id });
  const stopped = await wait(low.id, ['budget_exceeded']);
  assert.equal(stopped.usage.toolCalls, 1);
  const pending = await request('/projects/' + low.id + '/action', { action: 'expand' });
  assert.equal(pending.status, 'awaiting_approval');
  assert.equal(pending.budget.maxToolCalls, 1);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await request('/projects/' + low.id)).usage.toolCalls, 1);
  await request('/projects/' + low.id + '/action', { action: 'reject' });
  await request('/projects/' + low.id + '/action', { action: 'retry' }, 409);
  const renewed = await request('/projects/' + low.id + '/action', { action: 'expand' });
  await request('/projects/' + low.id + '/approve', {
    approvalId: renewed.approvals.find((a) => a.status === 'pending').id,
  });
  const expanded = await wait(low.id, ['completed', 'partial', 'blocked', 'budget_exceeded']);
  assert.equal(expanded.status, 'completed');
  const interrupted = await request('/projects', { goal: boot.defaultGoal }, 201);
  await request('/projects/' + interrupted.id + '/fault', { fault: 'interrupt_once' });
  await request('/projects/' + interrupted.id + '/approve', {
    approvalId: interrupted.approvals[0].id,
  });
  const paused = await wait(interrupted.id, ['paused', 'blocked', 'budget_exceeded', 'completed']);
  assert.equal(paused.status, 'paused');
  assert.ok(paused.checkpoints.length > 0);
  const committedTasks = paused.tasks
    .filter((t) => t.status === 'done')
    .map((t) => ({ id: t.id, attempts: t.attempts }));
  writeFileSync(
    'work/public-resilience-state.json',
    JSON.stringify({
      projectId: paused.id,
      committedTasks,
      checkpointTaskIds: paused.checkpoints.map((c) => c.taskId),
    }),
  );
  const result = {
    testedAt: new Date().toISOString(),
    base,
    checks: [
      'stale data yields partial research with explicit gaps',
      'budget exhaustion stops at approved limit',
      'pending or rejected expansion cannot execute',
      'approved expansion resumes original scope',
      'interrupt saves completed checkpoints',
    ],
    stale: { id: stale.id, status: degraded.status, gaps: degraded.gaps.length },
    budget: { id: low.id, status: expanded.status, initialLimit: 1 },
    interruption: { id: paused.id, status: paused.status, committedTasks: committedTasks.length },
    afterRestart: null,
  };
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
