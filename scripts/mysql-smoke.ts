import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MysqlStore, ConflictError } from '../server/store.ts';
import { demoPlan, newProject, approvalHash, fieldEvidence } from '../server/research.ts';
import { demoRows } from '../server/data.ts';
import { exportBundle, verifyBundle } from '../server/export.ts';
const url = process.env.MYSQL_TEST_URL;
if (!url)
  throw new Error(
    'Run scripts/test-mysql.ps1 first, or set MYSQL_TEST_URL to an isolated test database.',
  );
const store = new MysqlStore(url);
await store.init();
const p = newProject(
  'mysql-test-owner',
  '研究美的集团的经营质量',
  demoPlan('研究美的集团的经营质量', 'demo'),
  'demo',
  'demo',
);
await store.save(p);
const stale = (await store.get(p.id))!;
p.status = 'paused';
await store.save(p);
await assert.rejects(store.save(stale), ConflictError);
assert.equal((await store.list('mysql-test-owner')).find((x) => x.id === p.id)!.status, 'paused');
assert.equal((await store.list('other')).length, 0);
await store.saveMemory({
  id: p.id,
  owner: p.owner,
  text: '优先现金流，保留反证',
  kind: 'preference',
  createdAt: new Date().toISOString(),
});
assert.ok((await store.memories(p.owner)).some((m) => m.text.includes('现金流')));
await store.deleteMemory(p.id, 'other');
assert.ok((await store.memories(p.owner)).length);
await store.deleteMemory(p.id, p.owner);
assert.equal((await store.memories(p.owner)).length, 0);
assert.equal(await store.lease('worker-a'), true);
assert.equal(await store.lease('worker-b'), false);
await store.release('worker-a');
p.status = 'completed';
p.budget.maxModelCalls = 1;
p.approvals[0].status = 'approved';
p.approvals[0].planHash = approvalHash(p.plan, p.budget);
await store.save(p);
const input = {
  projectId: p.id,
  planVersion: 1,
  kind: 'model' as const,
  purpose: 'mysql-budget-check',
  mode: 'live' as const,
};
const reservations = await Promise.allSettled([
  store.reserveCall({ ...input, key: 'one' }),
  store.reserveCall({ ...input, key: 'two' }),
]);
assert.equal(reservations.filter((r) => r.status === 'fulfilled').length, 1);
const reserved = reservations.find((r) => r.status === 'fulfilled')!;
assert.equal(reserved.status, 'fulfilled');
const callId = (reserved as PromiseFulfilledResult<any>).value.id;
const starts = await Promise.allSettled([store.startCall(callId), store.startCall(callId)]);
assert.equal(starts.filter((r) => r.status === 'fulfilled').length, 1);
await store.finishCall(callId, { state: 'unknown', endedAt: new Date().toISOString() });
await store.save(p);
assert.equal((await store.get(p.id))!.usage.modelCalls, 1);
const evidence = demoRows(p.plan.entities[0], p.plan.years).flatMap(fieldEvidence);
await store.persistEvidence(p.id, evidence);
await assert.rejects(store.persistEvidence(p.id, [{ ...evidence[0], value: 1 }]), /不可变/);
assert.equal((await store.evidence(p.id, evidence[0].id))[0].value, evidence[0].value);
const old = newProject(
  'legacy-owner',
  '研究美的集团',
  demoPlan('研究美的集团', 'demo'),
  'demo',
  'demo',
);
delete old.schemaVersion;
old.status = 'running';
old.approvals[0].status = 'approved';
old.usage.modelCalls = 7;
await store.save(old);
await store.init();
assert.equal((await store.get(old.id))!.legacyUsage!.modelCalls, 7);
assert.equal((await store.get(old.id))!.status, 'paused');
await store.close();
const base = 'http://127.0.0.1:4329';
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  env: {
    ...process.env,
    DATABASE_URL: url,
    SESSION_SECRET: 'isolated-mysql-test-only',
    PORT: '4329',
    HOST: '127.0.0.1',
    DATA_MODE: 'demo',
    MODEL_MODE: 'demo',
    TASK_DELAY_MS: '5',
    APP_ACCESS_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout?.on('data', (d) => (logs += d));
child.stderr?.on('data', (d) => (logs += d));
let cookie = '';
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  async function call(path: string, body?: unknown) {
    const r = await fetch(`${base}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.getSetCookie().length)
      cookie = r.headers
        .getSetCookie()
        .map((x) => x.split(';')[0])
        .join('; ');
    const data = await r.json();
    assert.ok(r.ok, data.error);
    return data;
  }
  const boot = await call('/bootstrap');
  assert.equal(boot.config.database, 'MySQL');
  const project = await call('/projects', { goal: boot.defaultGoal });
  await call(`/projects/${project.id}/approve`, { approvalId: project.approvals[0].id });
  let done: any;
  for (let i = 0; i < 120; i++) {
    done = await call(`/projects/${project.id}`);
    if (done.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(done.status, 'completed');
  assert.ok(done.checkpoints.length);
  assert.equal(done.completion.outcome, 'met');
  assert.ok(done.counterChecks.some((c: any) => c.status === 'checked'));
  assert.ok(done.claimRevisions.length);
  const bundle = await call(`/projects/${project.id}/bundle`);
  assert.equal(verifyBundle(bundle).valid, true, JSON.stringify(verifyBundle(bundle)));
  const report = {
    testedAt: new Date().toISOString(),
    database: 'MySQL 8.0 isolated local instance',
    persistence: true,
    optimisticConcurrency: true,
    ownerIsolation: true,
    workerLease: true,
    unicodeMemory: true,
    atomicBudgetReservation: true,
    singleDispatch: true,
    durableInterruptedUsage: true,
    immutableEvidence: true,
    legacyMigration: true,
    standaloneBundle: verifyBundle(bundle),
    countercheckRevision: true,
    completionCriteria: 'met',
    httpMainChain: 'completed',
    evidenceCount: done.evidence.length,
    checkpointCount: done.checkpoints.length,
  };
  mkdirSync('outputs', { recursive: true });
  writeFileSync('outputs/v2-mysql-test-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}
