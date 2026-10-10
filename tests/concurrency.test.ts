import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoPlan } from '../server/research.ts';
let child: ChildProcess;
let base = '';
let cookie = '';
let followups = 0;
let lastInput: any;
let dbPath = '';
let holdFollowup = false;
const provider = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const payload = JSON.parse(body);
  const input = JSON.parse(payload.input);
  const name = payload.text.format.name;
  let value: any;
  if (name === 'research_plan') {
    const { version, question, ...p } = demoPlan(input.goal, 'demo');
    value = p;
  } else if (name === 'evidence_followup') {
    followups++;
    lastInput = input;
    await new Promise((r) => setTimeout(r, holdFollowup ? 2500 : 150));
    value = {
      answer: '当前证据只支持局部观察，应结合原始材料核查解释。',
      evidenceIds: [input.evidence[0].id],
    };
  } else
    value = {
      summary: '当前证据支持局部比较。',
      interpretations: [],
      nextQuestions: ['继续核查原文。'],
    };
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      id: `mock-${name}`,
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
      usage: { input_tokens: 80, output_tokens: 40 },
    }),
  );
});
test('连续追问向供应商提供近期对话、用户纠正与实际选中的引用', async () => {
  const p = (await request('/projects', { goal: '研究美的集团的经营现金流' })).value;
  await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
  for (let i = 0; i < 150; i++) {
    if ((await request(`/projects/${p.id}`)).value.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(`/projects/${p.id}/chat`, {
    text: '更正：我指的是回款持续性，而不是整体经营质量。',
  });
  const second = await request(`/projects/${p.id}/chat`, { text: '刚才那条解释还有哪些边界？' });
  assert.equal(second.status, 200);
  assert.ok(lastInput.history.some((m: any) => m.role === 'assistant'));
  assert.ok(lastInput.context.userCorrections.some((m: any) => m.text.includes('回款持续性')));
  assert.ok(second.value.calls.findLast((c: any) => c.kind === 'model').inputChars > 0);
});
async function request(path: string, body?: unknown) {
  const r = await fetch(base + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cs = r.headers.getSetCookie();
  if (cs.length) cookie = cs.map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, value: await r.json() };
}
async function launch() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    env: {
      ...process.env,
      PORT: '4329',
      DATABASE_URL: '',
      SQLITE_PATH: dbPath,
      SESSION_SECRET: 'test-only',
      DATA_MODE: 'demo',
      MODEL_MODE: 'live',
      MODEL_API_KEY: 'protocol-only',
      MODEL_NAME: 'mock',
      MODEL_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}`,
      MODEL_INPUT_USD_PER_MILLION: '1',
      MODEL_OUTPUT_USD_PER_MILLION: '2',
      TASK_DELAY_MS: '1',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('test service not ready');
}
async function stop() {
  if (child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
  }
}
before(async () => {
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
  mkdirSync('work', { recursive: true });
  const dir = mkdtempSync(resolve('work/concurrency-'));
  dbPath = resolve(dir, 'test.sqlite');
  base = 'http://127.0.0.1:4329';
  await launch();
});
after(async () => {
  await stop();
  await new Promise<void>((r) => provider.close(() => r()));
});
test('并发追问在供应商边界只发出一次请求，结果与已发生用量完整保存', async () => {
  const before = followups;
  await request('/bootstrap');
  const p = (await request('/projects', { goal: '研究美的集团的经营现金流' })).value;
  await request(`/projects/${p.id}/budget`, {
    maxModelCalls: 3,
    maxToolCalls: 12,
    maxSeconds: 180,
  });
  await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
  for (let i = 0; i < 150; i++) {
    if ((await request(`/projects/${p.id}`)).value.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const replies = await Promise.all([
    request(`/projects/${p.id}/chat`, { text: '核查利润的解释', requestId: 'first' }),
    request(`/projects/${p.id}/chat`, { text: '核查利润的解释', requestId: 'second' }),
  ]);
  assert.equal(followups - before, 1);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const current = (await request(`/projects/${p.id}`)).value;
  assert.equal(current.usage.modelCalls, 3);
  assert.equal(current.usage.inputTokens, 240);
  assert.equal(current.calls.filter((c: any) => c.kind === 'model').length, 3);
  assert.ok(
    current.calls.filter((c: any) => c.kind === 'model').every((c: any) => c.mode === 'live'),
  );
  assert.equal(current.messages.at(-1).evidenceIds.length, 1);
  const replay = await request(`/projects/${p.id}/chat`, {
    text: '核查利润的解释',
    requestId: 'first',
  });
  assert.equal(replay.status, 409);
  assert.equal(followups - before, 1);
});

test('供应商请求已发出时杀死进程，重启仍保留收费记录且禁止同键重发', async () => {
  const p = (await request('/projects', { goal: '研究美的集团的经营现金流' })).value;
  await request(`/projects/${p.id}/approve`, { approvalId: p.approvals[0].id });
  for (let i = 0; i < 150; i++) {
    if ((await request(`/projects/${p.id}`)).value.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const before = (await request(`/projects/${p.id}`)).value.usage.modelCalls;
  const received = followups;
  holdFollowup = true;
  const pending = request(`/projects/${p.id}/chat`, {
    text: '核查现金流的持续性',
    requestId: 'interrupt-paid',
  }).catch(() => undefined);
  for (let i = 0; i < 50 && followups === received; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(followups, received + 1);
  await stop();
  await pending;
  holdFollowup = false;
  await launch();
  const current = (await request(`/projects/${p.id}`)).value;
  assert.equal(current.usage.modelCalls, before + 1);
  const interrupted = current.calls.find((c: any) => c.key.includes('interrupt-paid'));
  assert.equal(interrupted.state, 'unknown');
  assert.equal(interrupted.usageKnown, undefined);
  assert.ok(current.usage.unknownUsageCalls >= 1);
  assert.equal(
    (
      await request(`/projects/${p.id}/chat`, {
        text: '核查现金流的持续性',
        requestId: 'interrupt-paid',
      })
    ).status,
    409,
  );
  assert.equal(followups, received + 1);
});
