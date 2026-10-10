import { randomUUID } from 'node:crypto';
import type { Project, Task } from '../shared/types.ts';
import type { Store } from './store.ts';
import { ConflictError } from './store.ts';
import { DataAdapter, DataError } from './data.ts';
import { config } from './config.ts';
import {
  baseReport,
  calculate,
  compact,
  event,
  fieldEvidence,
  filingEvidence,
  now,
  uid,
} from './research.ts';
import { synthesize } from './model.ts';
import { requireGrant } from './policy.ts';
import { withCalls, BudgetError } from './calls.ts';
import { requiredFields, evaluateCompletion } from './planning.ts';
import { checkCounterevidence, applyCounterchecks } from './counterchecks.ts';
import { sealEvidence } from './evidence.ts';
export class Engine {
  worker = randomUUID();
  timer?: ReturnType<typeof setInterval>;
  heartbeat?: ReturnType<typeof setInterval>;
  busy = false;
  stopped = false;
  controllers = new Map<string, AbortController>();
  data = new DataAdapter();
  constructor(public store: Store) {}
  start() {
    this.timer = setInterval(
      () => void this.tick().catch((e) => console.error('worker tick:', e.message)),
      250,
    );
    this.heartbeat = setInterval(
      () => {
        if (this.busy)
          void this.store
            .lease(this.worker)
            .then((ok) => {
              if (!ok) for (const c of this.controllers.values()) c.abort();
            })
            .catch((e) => console.error('worker heartbeat:', e.message));
      },
      Math.floor(config.leaseMs / 3),
    );
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.controllers.values()) c.abort();
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    await this.store.release(this.worker);
  }
  abort(id: string) {
    this.controllers.get(id)?.abort();
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      if (!(await this.store.lease(this.worker))) return;
      const projects = await this.store.list();
      const p = projects.find((p) => p.status === 'running');
      if (!p) return;
      try {
        requireGrant(p);
      } catch (e) {
        p.status = 'blocked';
        event(p, 'run.blocked', (e as Error).message);
        await this.store.save(p);
        return;
      }
      const interrupted = p.tasks.filter((t) => t.status === 'running');
      if (interrupted.length) {
        for (const t of interrupted) {
          t.status = 'queued';
          event(p, 'task.recovered', `${t.label}从持久化状态恢复；已完成任务保持不变`, {
            taskId: t.id,
          });
        }
        await this.store.save(p);
        return;
      }
      if (p.tasks.some((t) => t.tool === 'resolve_entities' && t.status === 'failed')) {
        p.status = 'blocked';
        event(p, 'run.blocked', '对象核对未通过；扩展预算不会绕过核对，请重试失败任务');
        await this.store.save(p);
        return;
      }
      const task = p.tasks.find(
        (t) =>
          t.status === 'queued' &&
          t.dependencies.every((d) =>
            p.tasks.some((x) => x.id === d && ['done', 'failed', 'skipped'].includes(x.status)),
          ),
      );
      if (!task) {
        if (!p.tasks.some((t) => ['queued', 'running'].includes(t.status))) {
          p.completion = evaluateCompletion(p);
          p.status = p.completion.outcome === 'met' ? 'completed' : 'partial';
          event(
            p,
            'run.completed',
            p.status === 'partial'
              ? '已保存部分成果，请查看数据缺口'
              : '研究完成，成果与证据已保存',
          );
          await this.store.save(p);
        }
        return;
      }
      if (p.usage.elapsedMs >= p.budget.maxSeconds * 1000) {
        p.status = 'budget_exceeded';
        event(p, 'budget.exceeded', '已达到调用次数或运行耗时预算；阶段证据已保留');
        await this.store.save(p);
        return;
      }
      await this.execute(p, task);
    } finally {
      this.busy = false;
    }
  }
  async execute(p: Project, task: Task) {
    requireGrant(p, task);
    return withCalls(
      {
        store: this.store,
        projectId: p.id,
        planVersion: p.plan.version,
        key: `${task.id}:attempt-${task.attempts + 1}`,
        taskId: task.id,
        mode: p.dataMode,
      },
      () => this.runTask(p, task),
    );
  }
  private async runTask(p: Project, task: Task) {
    task.status = 'running';
    task.attempts++;
    task.startedAt = now();
    event(p, 'task.started', task.label, { taskId: task.id, attempt: task.attempts });
    await this.store.save(p);
    const startingRevision = p.revision;
    const controller = new AbortController();
    this.controllers.set(p.id, controller);
    const remaining = Math.max(1, p.budget.maxSeconds * 1000 - p.usage.elapsedMs);
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(
        remaining,
        ['build_report', 'form_claims', 'check_counterevidence'].includes(task.tool)
          ? 27000
          : 16000,
      ),
    );
    const started = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, config.delayMs);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DataError('任务已停止或超时', true));
          },
          { once: true },
        );
      });
      if (p.fault === 'interrupt_once' && !p.faultConsumed && task.tool === 'fetch_filings') {
        p.faultConsumed = true;
        task.status = 'queued';
        p.status = 'paused';
        event(
          p,
          'fault.interrupted',
          '【故障实验】执行中断，已保留财务任务与检查点；点击继续从缺失任务恢复',
        );
      } else {
        if (p.fault === 'filings_timeout' && task.tool === 'fetch_filings' && !p.faultConsumed) {
          if (task.attempts >= 2) p.faultConsumed = true;
          throw new DataError('【故障实验】公告接口超时', true);
        }
        if (task.tool === 'resolve_entities')
          task.result = await this.data.resolve(p.plan.entities, p.dataMode, controller.signal);
        else if (task.tool === 'fetch_financials') {
          if (p.fault === 'unit_conflict' && !p.faultConsumed) {
            p.faultConsumed = true;
            throw new DataError('【故障实验】返回万元与元的冲突口径，已阻止计算');
          }
          if (p.fault === 'stale_data' && !p.faultConsumed) {
            p.faultConsumed = true;
            throw new DataError('【故障实验】采集快照已过期，无法作为正常结果');
          }
          const rows = await this.data.financials(
            task.entity!,
            p.plan,
            p.dataMode,
            controller.signal,
          );
          if (p.fault === 'financial_missing' && !p.faultConsumed) {
            rows[rows.length - 1].operatingCashflow = null;
            p.faultConsumed = true;
          }
          task.result = rows;
          const replaced = p.evidence.filter(
            (e) =>
              e.type === 'field' &&
              e.entity === task.entity!.name &&
              rows.some((r) => r.year === e.year),
          );
          p.archivedEvidence = [...(p.archivedEvidence || []), ...replaced];
          p.evidence = p.evidence.filter((e) => !replaced.includes(e));
          for (const row of rows)
            for (const e of fieldEvidence(row).map((e) => sealEvidence(e, p.plan.version)))
              if (!p.evidence.some((x) => x.id === e.id)) p.evidence.push(e);
          rows.forEach((r) => {
            for (const field of requiredFields(p.plan))
              if (r[field] === null) p.gaps.push(`${r.name} ${r.year}年${field}字段缺失`);
          });
        } else if (task.tool === 'fetch_filings') {
          const filings = await this.data.filings(
            task.entity!,
            p.plan,
            p.dataMode,
            controller.signal,
          );
          task.result = filings;
          if (!filings.length) p.gaps.push(`${task.entity!.name}未检索到公开材料，反证检查不完整`);
          for (const f of filings) {
            const e = filingEvidence(f, p.plan.version);
            if (!p.evidence.some((x) => x.id === e.id)) p.evidence.push(e);
          }
        } else if (task.tool === 'calculate_metrics') {
          const calculated = calculate(p.plan, p.evidence);
          p.evidence.push(
            ...calculated.evidence.filter((e) => !p.evidence.some((x) => x.id === e.id)),
          );
          p.gaps.push(...calculated.gaps);
          task.result = { evidenceIds: calculated.evidence.map((e) => e.id) };
        } else if (task.tool === 'form_claims') {
          p.context = compact(p);
          event(p, 'context.compacted', '已压缩上下文；原始证据保留，摘要携带约束与证据引用', {
            beforeChars: p.context.beforeChars,
            afterChars: p.context.afterChars,
          });
          if (p.fault === 'model_failure' && !p.faultConsumed) {
            p.faultConsumed = true;
            p.report = baseReport(p, 'fallback');
            event(p, 'model.failed', '【故障实验】模型不可用，已保留确定性事实表和研究边界');
          } else p.report = await synthesize(p, controller.signal);
          task.result = { createdAt: p.report.createdAt, claimCount: p.report.claims.length };
        } else if (task.tool === 'check_counterevidence') {
          const result = await checkCounterevidence(p, task.entity!, this.data, controller.signal);
          p.counterChecks = [
            ...(p.counterChecks || []).filter((c) => c.entity !== task.entity!.code),
            result.check,
          ];
          p.evidence.push(...result.evidence.filter((e) => !p.evidence.some((v) => v.id === e.id)));
          task.result = result.check;
          if (result.check.status === 'unavailable')
            p.gaps.push(
              `${task.entity!.name}反证核查未完成：${result.check.limitations.join('；')}`,
            );
        } else if (task.tool === 'build_report') {
          if (!p.report) p.report = baseReport(p, 'fallback');
          applyCounterchecks(p);
          p.report.gaps = [...new Set([...p.report.gaps, ...p.gaps])];
          task.result = { createdAt: p.report.createdAt, claimCount: p.report.claims.length };
          p.messages.push({
            id: uid(),
            role: 'assistant',
            planVersion: p.plan.version,
            text: '阶段研究已保存。请检查支持材料、反证覆盖与判断变化。',
            at: now(),
            evidenceIds: p.evidence.map((e) => e.id),
          });
        } else throw new DataError('工具未注册，已拒绝执行');
        task.status = 'done';
        task.endedAt = now();
        task.error = undefined;
        p.checkpoints.push({
          id: uid(),
          at: now(),
          taskId: task.id,
          planVersion: p.plan.version,
          completedTaskIds: p.tasks.filter((t) => t.status === 'done').map((t) => t.id),
          evidenceIds: p.evidence.map((e) => e.id),
        });
        event(p, 'task.completed', `${task.label}完成，结果与检查点已保存`, { taskId: task.id });
      }
    } catch (e) {
      const error = e as Error;
      task.error = error.message;
      if (e instanceof BudgetError) {
        p.status = 'budget_exceeded';
        task.status = 'queued';
        event(p, 'budget.exceeded', error.message);
      } else if (controller.signal.aborted && Date.now() - started >= remaining) {
        p.status = 'budget_exceeded';
        task.status = 'queued';
        event(p, 'budget.exceeded', '任务达到总运行耗时预算，已停止并保存状态');
      } else if (
        e instanceof DataError &&
        e.retryable &&
        task.attempts - (task.retryBase || 0) < 2
      ) {
        task.status = 'queued';
        event(p, 'task.retry', `${task.label}失败，将在预算内重试一次`, { error: task.error });
      } else {
        task.status = 'failed';
        task.endedAt = now();
        p.gaps.push(`${task.label}：${task.error}`);
        event(p, 'task.failed', `${task.label}未完成，已记录缺口`, { error: task.error });
        if (task.tool === 'resolve_entities') {
          p.status = 'blocked';
          event(p, 'run.blocked', '对象核对未通过，已停止后续取数');
        }
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(p.id);
      const elapsed = Date.now() - started;
      task.durationMs += elapsed;
      await this.store.persistEvidence(p.id, p.evidence);
      p.usage.elapsedMs += elapsed;
      p.gaps = [...new Set(p.gaps)];
      // A worker that lost its lease cannot commit an aggregate result. The
      // independent request ledger and immutable snapshots are still retained.
      if (!(await this.store.lease(this.worker))) return;
      const latest = await this.store.get(p.id);
      if (latest && latest.revision === startingRevision) {
        try {
          await this.store.save(p);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
        }
      } else if (latest) {
        event(latest, 'task.discarded', '运行期间计划或状态发生变化，已丢弃旧任务的未提交结果', {
          taskId: task.id,
        });
        latest.usage.elapsedMs += elapsed;
        latest.usage.modelCalls += Math.max(0, p.usage.modelCalls - latest.usage.modelCalls);
        latest.usage.inputTokens += Math.max(0, p.usage.inputTokens - latest.usage.inputTokens);
        latest.usage.outputTokens += Math.max(0, p.usage.outputTokens - latest.usage.outputTokens);
        if (latest.tasks.find((t) => t.id === task.id)?.status === 'running') {
          latest.tasks.find((t) => t.id === task.id)!.status = 'queued';
        }
        await this.store.save(latest);
      }
    }
  }
}
