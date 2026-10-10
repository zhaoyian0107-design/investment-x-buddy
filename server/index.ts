import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { config } from './config.ts';
import { createStore, ConflictError } from './store.ts';
import { Engine } from './engine.ts';
import { requireGrant } from './policy.ts';
import { withCalls } from './calls.ts';
import { PolicyError } from './policy.ts';
import { requiredFields } from './planning.ts';
import { exportBundle } from './export.ts';
import { safeNarrative } from './claims.ts';
import { capabilities } from './data.ts';
import { planGoal, applyModelUsage, modelJson } from './model.ts';
import {
  addApproval,
  approvalHash,
  buildTasks,
  compact,
  DEFAULT_GOAL,
  DEMO_ENTITIES,
  demoPlan,
  event,
  exportMarkdown,
  guardRequest,
  newProject,
  now,
  uid,
  validatePlan,
} from './research.ts';
import type { Project, Memory, Fault } from '../shared/types.ts';
const store = await createStore();
const engine = new Engine(store);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
const sign = (v: string) => createHmac('sha256', config.sessionSecret).update(v).digest('hex');
function safeEqual(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host)
      return res.status(403).json({ error: '跨站写入已拒绝' });
    if (!req.is('application/json')) return res.status(415).json({ error: '请使用 JSON 请求' });
  }
  next();
});
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, database: config.databaseUrl ? 'mysql' : 'sqlite', version: '2.0.0' }),
);
app.post('/api/login', (req, res) => {
  if (!config.accessToken || safeEqual(String(req.body?.token || ''), config.accessToken)) {
    res.cookie('buddy_access', sign('access'), {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
      maxAge: 86400000,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: '访问口令不正确' });
});
app.use('/api', (req, res, next) => {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')),
  );
  if (config.accessToken && !safeEqual(cookies.buddy_access || '', sign('access')))
    return res.status(401).json({ error: '请先输入部署访问口令' });
  const raw = cookies.buddy_session;
  let owner: string;
  if (
    raw &&
    /^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(raw) &&
    safeEqual(raw.split('.')[1], sign(raw.split('.')[0]))
  )
    owner = raw.split('.')[0];
  else {
    owner = randomBytes(16).toString('hex');
    res.cookie('buddy_session', `${owner}.${sign(owner)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
      maxAge: 30 * 86400000,
    });
  }
  res.locals.owner = owner;
  next();
});
const publicProject = (p: Project) => {
  const { owner, ...rest } = p;
  return rest;
};
async function owned(id: string, owner: string) {
  const p = await store.get(id);
  if (!p || p.owner !== owner) {
    const e: any = new Error('研究项目不存在');
    e.status = 404;
    throw e;
  }
  return p;
}
const createLimits = new Map<string, { at: number; count: number }>();
app.get('/api/bootstrap', async (_req, res) => {
  const owner = res.locals.owner;
  const projects = await store.list(owner);
  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      updatedAt: p.updatedAt,
      dataMode: p.dataMode,
      planVersion: p.plan.version,
    })),
    memories: await store.memories(owner),
    capabilities: capabilities(),
    defaultGoal: DEFAULT_GOAL,
    entities: DEMO_ENTITIES,
    config: {
      dataMode: config.dataMode,
      modelMode: config.modelMode,
      modelConfigured: !!config.modelKey && !!config.model,
      gatewayConfigured: !!config.gateway,
      database: config.databaseUrl ? 'MySQL' : 'SQLite',
      faultLab: config.faultLab,
    },
  });
});
app.post('/api/projects', async (req, res) => {
  const { goal } = z.object({ goal: z.string().trim().min(4).max(1500) }).parse(req.body);
  guardRequest(goal);
  const owner = res.locals.owner;
  const limit = createLimits.get(owner) || { at: Date.now(), count: 0 };
  if (Date.now() - limit.at > 3600000) {
    limit.at = Date.now();
    limit.count = 0;
  }
  if (limit.count >= 20) return res.status(429).json({ error: '本小时创建研究次数已达到上限' });
  limit.count++;
  createLimits.set(owner, limit);
  const preferences = (await store.memories(owner)).map(
    (m) => `${m.kind === 'hypothesis' ? '待核查假设（不可当作事实）' : '已确认偏好'}：${m.text}`,
  );
  const provisional = newProject(
    owner,
    goal,
    demoPlan(DEFAULT_GOAL, config.dataMode),
    config.dataMode,
    'demo',
    preferences,
  );
  // Planning has a separate one-call allowance; it never authorizes research tools.
  await store.save(provisional);
  let result: Awaited<ReturnType<typeof planGoal>>;
  try {
    result = await withCalls(
      {
        store,
        projectId: provisional.id,
        planVersion: 1,
        key: 'planning',
        planning: true,
        mode: config.dataMode,
      },
      () => planGoal(goal, config.dataMode, preferences),
    );
  } catch (e) {
    await store.update(provisional.id, (current) => {
      current.status = 'blocked';
      current.approvals.forEach((a) => (a.status = 'rejected'));
      event(current, 'planning.failed', (e as Error).message);
    });
    throw e;
  }
  const p = newProject(owner, goal, result.plan, config.dataMode, result.mode, preferences);
  p.id = provisional.id;
  p.revision = provisional.revision;
  if (result.usage) p.usage.elapsedMs += result.usage.durationMs;
  if (result.error) event(p, 'model.failed', result.error);
  await store.save(p);
  res.status(201).json(publicProject(p));
});
app.get('/api/projects/:id', async (req, res) =>
  res.json(publicProject(await owned(req.params.id, res.locals.owner))),
);
app.get('/api/projects/:id/events', async (req, res) => {
  const owner = res.locals.owner;
  await owned(req.params.id, owner);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let revision = -1;
  let busy = false;
  const send = async () => {
    if (busy) return;
    busy = true;
    try {
      const p = await owned(req.params.id, owner);
      if (p.revision !== revision) {
        revision = p.revision;
        res.write(`id: ${revision}\nevent: project\ndata: ${JSON.stringify(publicProject(p))}\n\n`);
      } else res.write(': heartbeat\n\n');
    } catch {
      res.end();
    } finally {
      busy = false;
    }
  };
  await send();
  const t = setInterval(() => void send(), 1000);
  req.on('close', () => clearInterval(t));
});
app.put('/api/projects/:id/plan', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  if (p.status === 'running') return res.status(409).json({ error: '请先暂停研究再修改计划' });
  if ((p.history?.length || 0) >= 10)
    return res.status(409).json({ error: '当前项目已保留十个历史版本，请建立新的研究项目' });
  const plan = validatePlan(req.body, p.goal, p.dataMode, p.plan.version + 1);
  p.history = [
    ...(p.history || []),
    {
      at: now(),
      plan: p.plan,
      tasks: p.tasks,
      evidence: p.evidence,
      report: p.report,
      checkpoints: p.checkpoints,
      counterChecks: p.counterChecks,
      claimRevisions: p.claimRevisions,
      completion: p.completion,
      context: p.context,
    },
  ];
  p.plan = plan;
  p.legacy = false;
  p.title = plan.title;
  p.tasks = buildTasks(plan);
  p.evidence = [];
  p.report = undefined;
  p.context = undefined;
  p.completion = undefined;
  p.counterChecks = [];
  p.claimRevisions = [];
  p.checkpoints = [];
  p.gaps = [];
  p.status = 'draft';
  p.faultConsumed = false;
  p.approvals.filter((a) => a.status === 'pending').forEach((a) => (a.status = 'rejected'));
  addApproval(p, 'initial', '计划已变更，请重新确认研究范围；旧检查点仅作为历史记录保留。');
  event(p, 'plan.changed', '研究计划已更新，旧证据与成果不用于新范围', { version: plan.version });
  await store.save(p);
  res.json(publicProject(p));
});
app.post('/api/projects/:id/approve', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  const a = p.approvals.find((a) => a.id === req.body.approvalId && a.status === 'pending');
  if (
    !a ||
    a.planVersion !== p.plan.version ||
    a.planHash !== approvalHash(p.plan, a.budget) ||
    a.expiresAt < now()
  )
    return res.status(409).json({ error: '审批已失效，请重新检查计划' });
  a.status = 'approved';
  a.approvedAt = now();
  p.budget = { ...a.budget };
  p.status = 'running';
  p.runStartedAt = now();
  event(p, 'approval.approved', '已确认范围与预算，开始只读研究', {
    planVersion: p.plan.version,
    budget: p.budget,
  });
  await store.save(p);
  res.json(publicProject(p));
});
app.post('/api/projects/:id/action', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  const { action } = z
    .object({
      action: z.enum(['pause', 'resume', 'cancel', 'retry', 'compact', 'expand', 'reject']),
    })
    .parse(req.body);
  if (action === 'pause') {
    if (p.status !== 'running') return res.status(409).json({ error: '当前研究没有运行' });
    p.status = 'paused';
    event(p, 'run.paused', '用户暂停研究，已提交结果保留');
  }
  if (action === 'cancel') {
    p.status = 'cancelled';
    p.approvals.filter((a) => a.status === 'pending').forEach((a) => (a.status = 'rejected'));
    event(p, 'run.cancelled', '研究已取消，阶段证据保留');
  }
  if (action === 'resume') {
    if (p.status !== 'paused')
      return res
        .status(409)
        .json({ error: '仅暂停的任务可以直接继续；失败任务请重试，预算不足请申请扩展' });
    requireGrant(p);
    p.status = 'running';
    event(p, 'run.resumed', '继续未完成任务，复用已提交检查点');
  }
  if (action === 'retry') {
    requireGrant(p);
    if (!['partial', 'blocked', 'paused'].includes(p.status))
      return res.status(409).json({ error: '当前没有可重试的受阻或部分研究' });
    if (
      p.usage.toolCalls >= p.budget.maxToolCalls ||
      p.usage.elapsedMs >= p.budget.maxSeconds * 1000
    )
      return res.status(409).json({ error: '预算不足，请先申请并确认扩展预算' });
    for (const t of p.tasks)
      if (
        t.status === 'failed' ||
        ['calculate_metrics', 'build_report', 'form_claims', 'check_counterevidence'].includes(
          t.tool,
        ) ||
        (t.tool === 'fetch_financials' &&
          p.evidence.some(
            (e) =>
              e.entity === t.entity?.name &&
              e.type === 'field' &&
              e.value == null &&
              requiredFields(p.plan).includes(e.field as any),
          )) ||
        (t.tool === 'fetch_filings' &&
          !p.evidence.some(
            (e) =>
              e.type === 'excerpt' && (e.entity === t.entity?.code || e.entity === t.entity?.name),
          ))
      ) {
        t.status = 'queued';
        t.error = undefined;
        t.retryBase = t.attempts;
        t.result = undefined;
      }
    p.archivedEvidence = [
      ...(p.archivedEvidence || []),
      ...p.evidence.filter((e) => e.type === 'calculation'),
    ];
    p.evidence = p.evidence.filter((e) => e.type !== 'calculation');
    p.gaps = [];
    p.counterChecks = [];
    p.report = undefined;
    p.status = 'running';
    event(p, 'run.retry', '重试缺失任务；有效财务数据继续复用，派生指标与成果将重建');
  }
  if (action === 'compact') {
    p.context = compact(p);
    event(p, 'context.compacted', '上下文已压缩，原始证据完整保留', {
      beforeChars: p.context.beforeChars,
      afterChars: p.context.afterChars,
    });
  }
  if (action === 'expand') {
    if (p.status === 'running') return res.status(409).json({ error: '请先暂停再申请预算扩展' });
    if (p.approvals.some((a) => a.status === 'pending'))
      return res.status(409).json({ error: '已有待确认审批' });
    const budget = {
      maxToolCalls: Math.min(36, p.budget.maxToolCalls + 12),
      maxModelCalls: Math.min(12, p.budget.maxModelCalls + 3),
      maxSeconds: Math.min(900, p.budget.maxSeconds + 180),
    };
    if (budget.maxToolCalls === p.budget.maxToolCalls && budget.maxSeconds === p.budget.maxSeconds)
      return res.status(409).json({ error: '已达到单个研究项目的预算上限' });
    addApproval(
      p,
      'expand',
      '继续研究需要更多调用预算。批准后继续原范围，拒绝则保持当前阶段成果。',
    );
    const a = p.approvals.at(-1)!;
    a.returnStatus = p.status;
    a.budget = budget;
    a.planHash = approvalHash(p.plan, budget);
    p.status = 'awaiting_approval';
    event(p, 'approval.requested', '预算扩展等待确认，未执行额外调用');
  }
  if (action === 'reject') {
    const rejected = p.approvals.findLast((a) => a.status === 'pending');
    p.approvals.filter((a) => a.status === 'pending').forEach((a) => (a.status = 'rejected'));
    p.status = rejected?.type === 'initial' ? 'draft' : rejected?.returnStatus || p.status;
    event(p, 'approval.rejected', '已拒绝审批，未执行待授权操作');
  }
  await store.save(p);
  if (['pause', 'cancel'].includes(action)) engine.abort(p.id);
  res.json(publicProject(p));
});
app.post('/api/projects/:id/budget', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  if (p.status !== 'draft') return res.status(409).json({ error: '仅计划确认前可设置初始预算' });
  p.budget = z
    .object({
      maxModelCalls: z.number().int().min(1).max(12),
      maxToolCalls: z.number().int().min(1).max(36),
      maxSeconds: z.number().int().min(1).max(900),
    })
    .parse(req.body);
  p.approvals
    .filter((a) => a.status === 'pending')
    .forEach((a) => {
      a.budget = { ...p.budget };
      a.planHash = approvalHash(p.plan, p.budget);
    });
  await store.save(p);
  res.json(publicProject(p));
});
app.post('/api/projects/:id/fault', async (req, res) => {
  if (!config.faultLab) return res.status(403).json({ error: '部署未启用故障实验' });
  const p = await owned(req.params.id, res.locals.owner);
  if (p.status !== 'draft') return res.status(409).json({ error: '请在计划确认前选择故障场景' });
  p.fault = z
    .enum([
      'none',
      'filings_timeout',
      'financial_missing',
      'unit_conflict',
      'model_failure',
      'interrupt_once',
      'stale_data',
    ])
    .parse(req.body.fault) as Fault;
  p.faultConsumed = false;
  event(p, 'fault.configured', p.fault === 'none' ? '正常研究路径' : `【故障实验】${p.fault}`);
  await store.save(p);
  res.json(publicProject(p));
});
app.post('/api/projects/:id/chat', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  requireGrant(p);
  if (p.status === 'running')
    return res.status(409).json({ error: '请等待当前研究完成或暂停后追问' });
  if (!p.evidence.length) return res.status(409).json({ error: '请先完成取数后再基于证据追问' });
  const { text, requestId } = z
    .object({
      text: z.string().trim().min(2).max(1500),
      requestId: z.string().min(1).max(80).optional(),
    })
    .parse(req.body);
  const command = requestId || uid();
  const requestStarted = Date.now();
  guardRequest(text);
  if (p.messages.length >= 60)
    return res.status(409).json({ error: '当前线程已达到消息上限，请建立新的研究项目' });
  p.messages.push({
    id: uid(),
    role: 'user',
    text,
    at: now(),
    evidenceIds: [],
    planVersion: p.plan.version,
    requestId: command,
  });
  const terms = text.match(/现金|利润|收入|反证|季节|营运|回款/g) || [];
  const selected = p.evidence.filter((e) =>
    terms.some((term) => e.label.includes(term) || String(e.raw).includes(term)),
  );
  const prior = p.messages
    .slice(0, -1)
    .findLast((m) => m.role === 'assistant' && (m.planVersion || 1) === p.plan.version);
  const recalled =
    /刚才|上一条|那条|之前/.test(text) && prior?.evidenceIds.length
      ? p.evidence.filter((e) => prior.evidenceIds.includes(e.id))
      : [];
  const evidence = (
    recalled.length ? recalled : selected.length ? selected : p.evidence.slice(-8)
  ).slice(0, 8);
  let answer = `当前可引用${evidence.length}条相关证据。${/为什么|反证|证明/.test(text) ? '现金利润比只描述现金流与利润的关系；营运资本、季节性和业务结构也可能解释差异，当前证据不能证明因果或整体优劣。' : '请结合证据抽屉中的报告期、单位和原始字段阅读变化。'}\n下一步可核查应收账款、存货和应付项目。目前这些字段未接入，已作为待解决问题。`;
  let modelMode = 'demo';
  let citedIds = evidence.map((e) => e.id);
  if (config.modelMode === 'live' && config.modelKey && config.model) {
    let accounted = false;
    const started = Date.now();
    try {
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['answer', 'evidenceIds'],
      };
      const result = await withCalls(
        {
          store,
          projectId: p.id,
          planVersion: p.plan.version,
          key: `chat:${command}`,
          mode: p.dataMode,
        },
        () =>
          modelJson(
            'evidence_followup',
            schema,
            '回答追问，只能依据输入证据；输出自然语言不要包含任何阿拉伯数字，不给买卖或仓位建议。引用只能选输入中的ID。记忆中的假设不可当作事实。',
            {
              question: text,
              context: compact(p),
              history: compact(p).recentMessages,
              evidence: evidence.map((e) => ({
                ...e,
                raw: e.type === 'excerpt' ? e.raw : undefined,
              })),
            },
            AbortSignal.timeout(
              Math.min(25000, Math.max(1, p.budget.maxSeconds * 1000 - p.usage.elapsedMs)),
            ),
          ),
      );
      applyModelUsage(p, result);
      accounted = true;
      const v = z
        .object({ answer: z.string().max(2500), evidenceIds: z.array(z.string()).min(1) })
        .parse(result.value);
      if (
        v.evidenceIds.some((id) => !evidence.some((e) => e.id === id)) ||
        !safeNarrative(v.answer)
      )
        throw new Error('追问输出未通过证据或边界校验');
      answer = v.answer;
      citedIds = [...new Set(v.evidenceIds)];
      modelMode = 'live';
    } catch (e) {
      if (e instanceof PolicyError) throw e;
      if (!accounted) applyModelUsage(p);
      modelMode = 'fallback';
      event(p, 'model.failed', '追问模型失败或输出未通过校验，已使用标注的证据检索降级');
    } finally {
      p.usage.elapsedMs += Date.now() - started;
    }
  } else if (config.modelMode === 'live') modelMode = 'fallback';
  p.messages.push({
    id: uid(),
    role: 'assistant',
    text: answer,
    at: now(),
    evidenceIds: citedIds,
    modelMode,
    planVersion: p.plan.version,
    requestId: command,
  });
  p.context = compact(p);
  event(p, 'evidence.retrieved', '已基于当前项目取回证据并回答追问', {
    evidenceIds: citedIds,
    modelMode,
  });
  const updated = await store.update(p.id, (current) => {
    if (current.plan.version !== p.plan.version) throw new ConflictError();
    requireGrant(current);
    if (current.messages.some((m) => m.requestId === command)) throw new ConflictError();
    current.messages.push(...p.messages.slice(-2));
    current.usage.elapsedMs += Date.now() - requestStarted;
    current.context = compact(current);
    event(current, 'chat.completed', '追问已保存，引用与调用记录可检查', { requestId: command });
  });
  res.json(publicProject(updated));
});
app.get('/api/projects/:id/export', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="research-${p.id}.md"`);
  res.send(exportMarkdown(p));
});
app.get('/api/projects/:id/bundle', async (req, res) => {
  const p = await owned(req.params.id, res.locals.owner);
  res.setHeader('Content-Disposition', `attachment; filename="research-${p.id}-bundle.json"`);
  res.json(exportBundle(p, await store.evidence(p.id), await store.snapshots(p.id)));
});
app.get('/api/projects/:id/evidence/:evidenceId', async (req, res) => {
  await owned(req.params.id, res.locals.owner);
  const e = (await store.evidence(req.params.id, req.params.evidenceId))[0];
  if (!e) return res.status(404).json({ error: '该版本证据不存在' });
  res.json(e);
});
app.post('/api/memories', async (req, res) => {
  const v = z
    .object({
      text: z.string().trim().min(2).max(500),
      kind: z.enum(['preference', 'hypothesis']),
      projectId: z.string().optional(),
    })
    .parse(req.body);
  if (v.projectId) await owned(v.projectId, res.locals.owner);
  const m: Memory = { ...v, id: uid(), owner: res.locals.owner, createdAt: now() };
  if ((await store.memories(m.owner)).length >= 30)
    return res.status(409).json({ error: '长期记忆已达到上限，请删除不再需要的条目' });
  await store.saveMemory(m);
  res.status(201).json(m);
});
app.delete('/api/memories/:id', async (req, res) => {
  await store.deleteMemory(req.params.id, res.locals.owner);
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    error.status || (error instanceof ConflictError ? 409 : error instanceof ZodError ? 400 : 400);
  res.status(status).json({
    error:
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
        : error.message || '请求失败',
  });
});
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Investment X Buddy: http://${config.host}:${config.port} (${config.databaseUrl ? 'MySQL' : 'SQLite'}; data=${config.dataMode}; model=${config.modelMode})`,
  );
  engine.start();
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await engine.stop();
  server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
