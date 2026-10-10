import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBundle } from '../shared/bundle.ts';
import type { Project } from '../shared/types.ts';

const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
assert.ok(base, 'Set PUBLIC_BASE_URL to the actual deployed URL.');
const target = new URL(base);
assert.ok(
  target.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(target.hostname),
  'A public deployment must use HTTPS.',
);
const expectedDatabase = process.env.PUBLIC_EXPECT_DATABASE || 'mysql';
const sessionFile = resolve('work/public-smoke-session.json');
const resume = process.argv.includes('--resume');
mkdirSync('work', { recursive: true });
mkdirSync('outputs', { recursive: true });

function client(initialCookie = '') {
  const cookies = new Map<string, string>();
  function absorb(values: string[]) {
    for (const value of values) {
      const pair = value.split(';')[0];
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  absorb(initialCookie.split(';').map((v) => v.trim()));
  return {
    cookie: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    async request<T = any>(path: string, body?: unknown, expectedStatus = 200) {
      const response = await fetch(`${base}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      absorb(response.headers.getSetCookie());
      assert.equal(response.status, expectedStatus, `${path}: unexpected HTTP status`);
      return (await response.json()) as T;
    },
  };
}
async function login(c: ReturnType<typeof client>) {
  if (process.env.PUBLIC_ACCESS_TOKEN)
    await c.request('/login', { token: process.env.PUBLIC_ACCESS_TOKEN });
}
const saved = resume ? JSON.parse(readFileSync(sessionFile, 'utf8')) : undefined;
if (resume) assert.equal(saved.base, base, 'Restart check must use the original deployment.');
const first = client(saved?.cookie);
await login(first);
const health = await first.request('/health');
assert.equal(health.ok, true);
assert.equal(health.version, '2.0.0');
assert.equal(health.database, expectedDatabase);
const checks: string[] = ['health, version and database'];

if (resume) {
  const project = await first.request<Project>(`/projects/${saved.projectId}`);
  assert.equal(project.status, 'completed');
  assert.deepEqual(project.evidence.map((e) => e.id).sort(), saved.evidenceIds);
  const bootstrap = await first.request('/bootstrap');
  assert.ok(bootstrap.memories.some((m: any) => m.id === saved.memoryId));
  const bundle = await first.request(`/projects/${project.id}/bundle`);
  const verification = verifyBundle(bundle);
  assert.equal(verification.valid, true);
  checks.push(
    'same signed session after restart',
    'project and evidence persistence',
    'memory persistence',
    'bundle verification',
  );
  const result = {
    testedAt: new Date().toISOString(),
    base,
    health,
    phase: 'after_restart',
    projectId: project.id,
    checks,
    verification,
  };
  writeFileSync('outputs/public-restart-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} else {
  const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(20000) });
  assert.equal(home.status, 200);
  const html = await home.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map((m) => m[1]);
  assert.ok(assets.length >= 2, 'Production JavaScript and CSS must be served.');
  for (const asset of assets) assert.equal((await fetch(`${base}${asset}`)).status, 200);
  checks.push('homepage and production assets');
  const bootstrap = await first.request('/bootstrap');
  assert.equal(
    bootstrap.config.dataMode,
    'demo',
    'Initial public acceptance uses labelled demo data.',
  );
  assert.equal(bootstrap.config.modelMode, 'demo');
  const rejected = await first.request<Project>(
    '/projects',
    { goal: '研究美的集团的经营质量' },
    201,
  );
  await first.request(`/projects/${rejected.id}/action`, { action: 'reject' });
  await first.request(`/projects/${rejected.id}/action`, { action: 'retry' }, 409);
  await first.request(`/projects/${rejected.id}/action`, { action: 'resume' }, 409);
  const denied = await first.request<Project>(`/projects/${rejected.id}`);
  assert.equal(denied.usage.toolCalls, 0);
  checks.push('rejected approval cannot execute');
  const project = await first.request<Project>('/projects', { goal: bootstrap.defaultGoal }, 201);
  await first.request(`/projects/${project.id}/approve`, { approvalId: project.approvals[0].id });
  let done: Project | undefined;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    done = await first.request<Project>(`/projects/${project.id}`);
    if (['completed', 'partial', 'blocked', 'budget_exceeded', 'cancelled'].includes(done.status))
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(done?.status, 'completed');
  assert.equal(done.completion?.outcome, 'met');
  assert.ok(done.report?.claims.length);
  assert.equal(done.checkpoints.length, done.tasks.length);
  assert.ok(done.claimRevisions?.length);
  assert.ok(done.counterChecks?.length);
  assert.ok(done.counterChecks.every((c) => c.status === 'checked'));
  checks.push(
    'plan approval and execution',
    'completion checks and checkpoints',
    'counterchecks and claim revisions',
  );
  const second = client();
  await login(second);
  await second.request('/bootstrap');
  await second.request(`/projects/${project.id}`, undefined, 404);
  await second.request(`/projects/${project.id}/evidence/${done.evidence[0].id}`, undefined, 404);
  checks.push('independent session isolation');
  await first.request(`/projects/${project.id}/evidence/${done.evidence[0].id}`);
  const bundle = await first.request(`/projects/${project.id}/bundle`);
  const verification = verifyBundle(bundle);
  assert.equal(verification.valid, true);
  checks.push('evidence retrieval and independent bundle verification');
  const memory = await first.request(
    '/memories',
    {
      text: '公网验收偏好：优先核查经营现金流的原始字段',
      kind: 'preference',
      projectId: project.id,
    },
    201,
  );
  const secondBootstrap = await second.request('/bootstrap');
  assert.ok(!secondBootstrap.memories.some((m: any) => m.id === memory.id));
  checks.push('memory persistence and isolation');
  // This file holds only the test session and remains in the ignored local work folder.
  writeFileSync(
    sessionFile,
    JSON.stringify({
      base,
      cookie: first.cookie(),
      projectId: project.id,
      memoryId: memory.id,
      evidenceIds: done.evidence.map((e) => e.id).sort(),
    }),
    { mode: 0o600 },
  );
  const result = {
    testedAt: new Date().toISOString(),
    base,
    health,
    phase: 'initial',
    projectId: project.id,
    checks,
    verification,
  };
  writeFileSync('outputs/public-smoke-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
