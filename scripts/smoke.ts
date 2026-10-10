import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { verifyBundle } from '../shared/bundle.ts';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
let cookie = '';
async function request(path: string, body?: unknown) {
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
  assert.ok(r.ok, `${r.status}: ${data.error}`);
  return data;
}
const bootstrap = await request('/bootstrap');
const p = await request('/projects', { goal: bootstrap.defaultGoal });
await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
let done: any;
for (let i = 0; i < 120; i++) {
  done = await request(`/projects/${p.id}`);
  if (['completed', 'partial', 'blocked', 'budget_exceeded'].includes(done.status)) break;
  await new Promise((r) => setTimeout(r, 250));
}
assert.equal(done.status, 'completed');
assert.ok(done.report.claims.length);
assert.ok(done.checkpoints.length);
assert.equal(done.completion.outcome, 'met');
assert.ok(done.claimRevisions.length);
assert.ok(done.counterChecks.every((c: any) => c.status === 'checked'));
const bundle = await request(`/projects/${p.id}/bundle`);
assert.equal(verifyBundle(bundle).valid, true, JSON.stringify(verifyBundle(bundle)));
const result = {
  testedAt: new Date().toISOString(),
  base,
  dataMode: done.dataMode,
  status: done.status,
  projectId: done.id,
  taskCount: done.tasks.length,
  evidenceCount: done.evidence.length,
  checkpointCount: done.checkpoints.length,
  modelMode: done.report.modelMode,
  completion: done.completion,
  counterChecks: done.counterChecks.length,
  claimRevisions: done.claimRevisions.length,
  bundle: verifyBundle(bundle),
};
mkdirSync('outputs', { recursive: true });
writeFileSync('outputs/v2-smoke-result.json', JSON.stringify(result, null, 2));
writeFileSync('outputs/v2-sample-bundle.json', JSON.stringify(bundle, null, 2));
console.log(JSON.stringify(result, null, 2));
