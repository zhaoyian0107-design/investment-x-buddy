import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import type { CallInput, CallRecord, Project, Usage } from '../shared/types.ts';
import { requireGrant, PolicyError } from './policy.ts';

export class BudgetError extends PolicyError {}
export class DuplicateCallError extends PolicyError {}
export function authorizeStart(p: Project, c: CallRecord) {
  if (p.plan.version !== c.planVersion) throw new PolicyError('计划已变更，旧请求不能执行');
  if (c.state !== 'reserved') throw new PolicyError('请求没有有效预算预占');
  if (Date.now() - Date.parse(c.reservedAt) > 60000)
    throw new PolicyError('预算预占已过期，未发出请求');
  if (c.planning) {
    if (p.status !== 'draft') throw new PolicyError('规划权限已失效');
    return;
  }
  const task = c.taskId ? p.tasks.find((t) => t.id === c.taskId) : undefined;
  requireGrant(p, task);
  if (c.taskId && (!task || task.status !== 'running' || p.status !== 'running'))
    throw new PolicyError('执行已暂停、取消或任务失效');
}
export function prepareCall(p: Project, records: CallRecord[], input: CallInput): CallRecord {
  for (const c of records)
    if (c.state === 'reserved' && Date.now() - Date.parse(c.reservedAt) > 60000) {
      c.state = 'released';
      c.endedAt = new Date().toISOString();
      c.error = '预算预占过期，未发出请求';
    }
  if (p.plan.version !== input.planVersion) throw new PolicyError('计划已变更，旧请求不能执行');
  if (records.some((c) => c.key === input.key))
    throw new DuplicateCallError('此请求已经处理，请刷新查看原结果');
  if (input.planning) {
    if (
      p.status !== 'draft' ||
      input.kind !== 'model' ||
      records.filter((c) => c.planning).length >= (p.planningAllowance || 0)
    )
      throw new PolicyError('规划调用权限已用尽');
  } else {
    requireGrant(p, input.taskId ? p.tasks.find((t) => t.id === input.taskId) : undefined);
    if (
      input.taskId &&
      (p.status !== 'running' ||
        !p.tasks.some((t) => t.id === input.taskId && t.status === 'running'))
    )
      throw new PolicyError('执行已经暂停、取消或任务失效');
    const base = p.ledgerBaseUsage;
    const used = (input.kind === 'model' ? base?.modelCalls : base?.toolCalls) || 0;
    const pending = records.filter((c) => c.kind === input.kind && c.state !== 'released').length;
    const limit = input.kind === 'model' ? p.budget.maxModelCalls : p.budget.maxToolCalls;
    if (used + pending >= limit || p.usage.elapsedMs >= p.budget.maxSeconds * 1000)
      throw new BudgetError('调用预算不足，未发出请求；请申请并确认扩展');
  }
  return { ...input, id: randomUUID(), state: 'reserved', reservedAt: new Date().toISOString() };
}
export function hydrateCalls(p: Project, records: CallRecord[]): Project {
  if (!p.ledgerBaseUsage) return p;
  const used = records.filter((c) => !['reserved', 'released'].includes(c.state));
  const base = p.ledgerBaseUsage;
  const model = used.filter((c) => c.kind === 'model');
  p.calls = records;
  p.usage = {
    ...base,
    elapsedMs: p.usage.elapsedMs,
    modelCalls: base.modelCalls + model.length,
    toolCalls: base.toolCalls + used.filter((c) => c.kind === 'tool').length,
    inputTokens: base.inputTokens + model.reduce((n, c) => n + (c.inputTokens || 0), 0),
    outputTokens: base.outputTokens + model.reduce((n, c) => n + (c.outputTokens || 0), 0),
    unknownUsageCalls: base.unknownUsageCalls + model.filter((c) => !c.usageKnown).length,
    costUsd: model.some((c) => c.costUsd != null)
      ? (base.costUsd || 0) + model.reduce((n, c) => n + (c.costUsd || 0), 0)
      : base.costUsd,
  };
  return p;
}
type Scope = {
  store: Store;
  projectId: string;
  planVersion: number;
  key: string;
  taskId?: string;
  planning?: boolean;
  mode: 'demo' | 'live';
};
const scopes = new AsyncLocalStorage<Scope>();
export const withCalls = <T>(scope: Scope, fn: () => Promise<T>) => scopes.run(scope, fn);
export async function tracked<T>(
  kind: 'tool' | 'model',
  purpose: string,
  fn: () => Promise<T>,
): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) return fn(); // standalone adapter/contract tests have no project authority
  const { store, ...input } = scope;
  const call = await store.reserveCall({
    ...input,
    kind,
    mode: kind === 'model' ? 'live' : scope.mode,
    purpose,
    key: `${scope.key}:${purpose}`,
  });
  const started = Date.now();
  let dispatched = false;
  try {
    await scope.store.startCall(call.id);
    dispatched = true;
    const result = await fn();
    const usage = kind === 'model' ? (result as any) : undefined;
    await scope.store.finishCall(call.id, {
      state: 'succeeded',
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      usageKnown: usage?.usageKnown,
      costUsd: usage?.costUsd,
      inputChars: usage?.inputChars,
      providerRequestId: (result as any)?.requestId,
    });
    return result;
  } catch (e) {
    const err = e as Error & { modelUsage?: Partial<CallRecord> };
    await scope.store.finishCall(call.id, {
      state: !dispatched ? 'released' : err.modelUsage ? 'failed' : 'unknown',
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      error: err.message,
      ...err.modelUsage,
    });
    throw e;
  }
}
