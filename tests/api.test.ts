import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project } from '../shared/types.ts';
mkdirSync(resolve('work'), { recursive: true });
const folder = mkdtempSync(resolve('work/api-'));
const port = 4318;
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let logs = '';
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SQLITE_PATH: resolve(folder, 'api.sqlite'),
      DATABASE_URL: '',
      SESSION_SECRET: 'automated-test-session-secret-not-production',
      APP_ACCESS_TOKEN: '',
      DATA_MODE: 'demo',
      MODEL_MODE: 'demo',
      TASK_DELAY_MS: '10',
      ENABLE_FAULT_LAB: 'true',
      WORKER_LEASE_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (logs += d));
  child.stderr?.on('data', (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Test server did not start: ${logs}`);
}
async function stop() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
}
before(start);
after(stop);
function client() {
  let cookie = '';
  return async function request<T = any>(path: string, body?: unknown, method?: string) {
    const response = await fetch(`${base}/api${path}`, {
      method: method || (body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const cs = response.headers.getSetCookie();
    if (cs.length) cookie = cs.map((x) => x.split(';')[0]).join('; ');
    const value = await response.json();
    return { status: response.status, value: value as T };
  };
}
async function awaitStatus(request: ReturnType<typeof client>, id: string, statuses: string[]) {
  for (let i = 0; i < 200; i++) {
    const { value } = await request<Project>(`/projects/${id}`);
    if (statuses.includes(value.status)) return value;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('研究未在预期时间内完成');
}
async function create(request: ReturnType<typeof client>, fault = 'none') {
  await request('/bootstrap');
  const { value: p, status } = await request<Project>('/projects', {
    goal: '比较美的集团与格力电器的经营现金流和利润',
  });
  assert.equal(status, 201);
  if (fault !== 'none') await request(`/projects/${p.id}/fault`, { fault });
  await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
  return p;
}
test('主链路：计划 → 审批 → 证据 → 成果 → 追问 → 导出', async () => {
  const request = client();
  const p = await create(request);
  const done = await awaitStatus(request, p.id, ['completed']);
  assert.ok(done.report);
  assert.equal(done.report.mode, 'demo');
  assert.ok(done.evidence.length > 10);
  assert.equal(done.checkpoints.length, done.tasks.length);
  assert.ok(
    done.report.claims.every((c) =>
      c.supportIds.every((id) => done.evidence.some((e) => e.id === id)),
    ),
  );
  const reply = await request<Project>(`/projects/${p.id}/chat`, {
    text: '为什么较高现金利润比不能证明经营质量更好？',
  });
  assert.equal(reply.status, 200);
  assert.ok(reply.value.messages.at(-1)!.evidenceIds.length > 0);
});

test('拒绝初始计划后，重试和继续都不能启动未授权研究', async () => {
  const request = client();
  await request('/bootstrap');
  const { value: p } = await request<Project>('/projects', { goal: '研究美的集团的经营质量' });
  await request(`/projects/${p.id}/action`, { action: 'reject' });
  assert.equal((await request(`/projects/${p.id}/action`, { action: 'retry' })).status, 409);
  assert.equal((await request(`/projects/${p.id}/action`, { action: 'resume' })).status, 409);
  await new Promise((r) => setTimeout(r, 400));
  const current = (await request<Project>(`/projects/${p.id}`)).value;
  assert.equal(current.usage.toolCalls, 0);
  assert.equal(current.evidence.length, 0);
});

test('新版本被拒绝不能沿用旧授权；拒绝扩展保持原预算与停止状态', async () => {
  const request = client();
  const p = await create(request);
  const done = await awaitStatus(request, p.id, ['completed']);
  await request(`/projects/${p.id}/plan`, { ...done.plan, title: '新版研究' }, 'PUT');
  await request(`/projects/${p.id}/action`, { action: 'reject' });
  assert.equal((await request(`/projects/${p.id}/action`, { action: 'resume' })).status, 409);
  assert.equal((await request(`/projects/${p.id}/action`, { action: 'retry' })).status, 409);
  const draft = (await request<Project>(`/projects/${p.id}`)).value;
  assert.equal(draft.evidence.length, 0);
  assert.equal(draft.plan.version, 2);
  const low = (await request<Project>('/projects', { goal: '研究美的集团的经营质量' })).value;
  await request(`/projects/${low.id}/budget`, {
    maxToolCalls: 1,
    maxModelCalls: 2,
    maxSeconds: 180,
  });
  await request(`/projects/${low.id}/approve`, { approvalId: low.approvals[0].id });
  await awaitStatus(request, low.id, ['budget_exceeded']);
  await request(`/projects/${low.id}/action`, { action: 'expand' });
  const rejected = (await request<Project>(`/projects/${low.id}/action`, { action: 'reject' }))
    .value;
  assert.equal(rejected.status, 'budget_exceeded');
  assert.equal(rejected.budget.maxToolCalls, 1);
});
test('Cookie 会话隔离，其他会话无法读取项目或继承记忆', async () => {
  const first = client();
  const second = client();
  const p = await create(first);
  await first('/memories', { text: '优先经营现金流', kind: 'preference', projectId: p.id });
  assert.equal((await second(`/projects/${p.id}`)).status, 404);
  assert.equal((await second('/bootstrap')).value.memories.length, 0);
  const next = await first<Project>('/projects', { goal: '研究海尔智家的经营质量' });
  assert.ok(next.value.preferences.some((x) => x.includes('优先经营现金流')));
});
test('公告超时重试后降级，重试缺失任务不重复获取已成功财务', async () => {
  const request = client();
  const p = await create(request, 'filings_timeout');
  const partial = await awaitStatus(request, p.id, ['partial']);
  assert.ok(partial.report!.gaps.some((x) => x.includes('超时')));
  assert.ok(partial.events.some((e) => e.type === 'task.retry'));
  const attempts = partial.tasks
    .filter((t) => t.tool === 'fetch_financials')
    .map((t) => t.attempts);
  await request(`/projects/${p.id}/action`, { action: 'retry' });
  const done = await awaitStatus(request, p.id, ['completed']);
  assert.deepEqual(
    done.tasks.filter((t) => t.tool === 'fetch_financials').map((t) => t.attempts),
    attempts,
  );
  assert.equal(done.report!.gaps.length, 0);
});
test('缺字段、单位冲突、过期数据均不能产生伪正常成果', async () => {
  for (const fault of ['financial_missing', 'unit_conflict', 'stale_data']) {
    const request = client();
    const p = await create(request, fault);
    const done = await awaitStatus(request, p.id, ['partial']);
    assert.ok(done.report!.gaps.length > 0);
    assert.equal(
      done.report!.claims.filter((c) => c.text.includes('Infinity') || c.text.includes('NaN'))
        .length,
      0,
    );
  }
});

test('缺字段重试重新取数并恢复完成，只研究收入不依赖现金流', async () => {
  const request = client();
  const p = await create(request, 'financial_missing');
  const partial = await awaitStatus(request, p.id, ['partial']);
  const first = partial.tasks.find((t) => t.tool === 'fetch_financials')!;
  await request(`/projects/${p.id}/action`, { action: 'retry' });
  const done = await awaitStatus(request, p.id, ['completed']);
  assert.ok(done.tasks.find((t) => t.id === first.id)!.attempts > first.attempts);
  assert.equal(done.report!.gaps.length, 0);
  const revenue = (await request<Project>('/projects', { goal: '研究美的集团，只看收入' })).value;
  await request(`/projects/${revenue.id}/fault`, { fault: 'financial_missing' });
  await request(`/projects/${revenue.id}/approve`, { approvalId: revenue.approvals[0].id });
  assert.equal(
    (await awaitStatus(request, revenue.id, ['completed', 'partial'])).status,
    'completed',
  );
});
test('不受当前工具支持的完成标准必须保持未达成', async () => {
  const request = client();
  await request('/bootstrap');
  const p = (await request<Project>('/projects', { goal: '研究美的集团，只看收入' })).value;
  const next = (
    await request<Project>(
      `/projects/${p.id}/plan`,
      {
        ...p.plan,
        completionCriteria: ['必须核查应收账款和存货变化', '核心指标可追溯且现金利润比高于十倍'],
      },
      'PUT',
    )
  ).value;
  await request(`/projects/${p.id}/approve`, {
    approvalId: next.approvals.find((a) => a.status === 'pending')!.id,
  });
  const result = await awaitStatus(request, p.id, ['partial', 'completed']);
  assert.equal(result.status, 'partial');
  assert.equal(result.completion!.criteria[0].status, 'unresolved');
});
test('历史证据可以在新计划中按原身份查询，导出包含计算输入', async () => {
  const request = client();
  const p = await create(request);
  const done = await awaitStatus(request, p.id, ['completed']);
  const original = done.evidence.find((e) => e.type === 'field' && e.field === 'netProfit')!;
  const bundle = (await request(`/projects/${p.id}/bundle`)).value;
  const { verifyBundle } = await import('../server/export.ts');
  assert.equal(verifyBundle(bundle).valid, true);
  await request(`/projects/${p.id}/plan`, { ...done.plan, title: '再次核查' }, 'PUT');
  const old = (await request(`/projects/${p.id}/evidence/${original.id}`)).value;
  assert.equal(old.value, original.value);
  assert.equal(old.contentHash, original.contentHash);
  assert.equal((await client()(`/projects/${p.id}/evidence/${original.id}`)).status, 404);
});
test('反证围绕具体判断执行，限制材料会收窄判断，无关材料不充当反证', async () => {
  const request = client();
  const p = await create(request);
  const done = await awaitStatus(request, p.id, ['completed']);
  assert.ok(done.counterChecks?.length);
  assert.ok(
    done.claimRevisions?.some(
      (r) => r.before.kind === 'hypothesis' && r.after.kind === 'inference',
    ),
  );
  const findings = done.counterChecks!.flatMap((c) => c.findings);
  assert.ok(findings.some((f) => f.relation === 'irrelevant'));
  const counters = done.report!.claims.flatMap((c) => c.counterIds);
  assert.ok(
    findings
      .filter((f) => f.relation === 'irrelevant')
      .every((f) => !counters.includes(f.evidenceId)),
  );
  for (const f of findings)
    assert.ok(String(done.evidence.find((e) => e.id === f.evidenceId)!.raw).includes(f.quote));
});
test('模型失败保留事实表，并明确模型降级状态', async () => {
  const request = client();
  const p = await create(request, 'model_failure');
  const done = await awaitStatus(request, p.id, ['completed']);
  assert.equal(done.report!.modelMode, 'fallback');
  assert.ok(done.report!.claims.some((c) => c.kind === 'fact'));
});
test('调用预算耗尽停止；未经批准不执行扩展调用', async () => {
  const request = client();
  await request('/bootstrap');
  const { value: p } = await request<Project>('/projects', {
    goal: '比较美的集团与格力电器的经营质量',
  });
  await request(`/projects/${p.id}/budget`, { maxToolCalls: 1, maxModelCalls: 2, maxSeconds: 180 });
  await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
  const stopped = await awaitStatus(request, p.id, ['budget_exceeded']);
  assert.equal(stopped.usage.toolCalls, 1);
  const { value: pending } = await request<Project>(`/projects/${p.id}/action`, {
    action: 'expand',
  });
  assert.equal(pending.status, 'awaiting_approval');
  assert.equal(pending.usage.toolCalls, 1);
  assert.equal(pending.budget.maxToolCalls, 1);
  await request(`/projects/${p.id}/approve`, {
    approvalId: pending.approvals.find((a) => a.status === 'pending')!.id,
  });
  assert.ok((await awaitStatus(request, p.id, ['completed'])).report);
});
test('旧版本审批失效，不能授权新范围；合规边界请求被拒绝', async () => {
  const request = client();
  await request('/bootstrap');
  const { value: p } = await request<Project>('/projects', {
    goal: '比较美的集团与格力电器的经营质量',
  });
  const changed = await request(
    `/projects/${p.id}/plan`,
    { ...p.plan, includeFilings: false },
    'PUT',
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id })).status,
    409,
  );
  assert.equal((await request('/projects', { goal: '现在应该买入哪只股票' })).status, 400);
});
test('中断后服务真实重启，已提交检查点和会话保持有效', async () => {
  const request = client();
  const p = await create(request, 'interrupt_once');
  const paused = await awaitStatus(request, p.id, ['paused']);
  const completed = paused.tasks
    .filter((t) => t.status === 'done')
    .map((t) => ({ id: t.id, attempts: t.attempts }));
  assert.ok(paused.checkpoints.length > 0);
  await stop();
  await start();
  const afterRestart = await request<Project>(`/projects/${p.id}`);
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.value.status, 'paused');
  await request(`/projects/${p.id}/action`, { action: 'resume' });
  const done = await awaitStatus(request, p.id, ['completed']);
  for (const t of completed)
    assert.equal(done.tasks.find((x) => x.id === t.id)!.attempts, t.attempts);
});
