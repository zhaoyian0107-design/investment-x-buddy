import type { Project, Task } from '../shared/types.ts';
import { approvalHash } from './research.ts';

export class PolicyError extends Error {
  status = 409;
}
export function requireGrant(p: Project, task?: Task) {
  const grant = p.approvals.findLast(
    (a) =>
      a.status === 'approved' &&
      a.planVersion === p.plan.version &&
      a.planHash === approvalHash(p.plan, p.budget) &&
      Date.parse(a.expiresAt) > Date.now(),
  );
  if (
    !grant ||
    p.status === 'cancelled' ||
    p.status === 'draft' ||
    p.status === 'awaiting_approval'
  )
    throw new PolicyError('当前计划没有有效执行授权，请检查范围与预算并重新确认');
  if (
    task?.entity &&
    !p.plan.entities.some((e) => e.code === task.entity!.code && e.name === task.entity!.name)
  )
    throw new PolicyError('任务对象超出批准的研究范围');
  if (
    task &&
    ![
      'resolve_entities',
      'fetch_financials',
      'fetch_filings',
      'calculate_metrics',
      'build_report',
      'form_claims',
      'check_counterevidence',
      'evaluate_completion',
    ].includes(task.tool)
  )
    throw new PolicyError('任务工具不在批准的能力范围');
  if (
    task &&
    ['fetch_filings', 'check_counterevidence'].includes(task.tool) &&
    !p.plan.includeFilings
  )
    throw new PolicyError('当前计划未授权公开材料查询');
  return grant;
}
