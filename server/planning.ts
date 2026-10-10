import type { Plan, Project, CompletionCriterion, CompletionEvaluation } from '../shared/types.ts';
import { COMPLETION_PRESETS } from '../shared/types.ts';
export function requiredFields(plan: Plan) {
  const fields = new Set<'revenue' | 'netProfit' | 'operatingCashflow'>();
  for (const m of plan.metrics)
    if (m === 'cashConversion') {
      fields.add('netProfit');
      fields.add('operatingCashflow');
    } else fields.add(m);
  return [...fields];
}
export function compileCriteria(labels: string[]): CompletionCriterion[] {
  return labels.map((label, i) => ({
    id: `criterion-${i}`,
    label,
    required: true,
    kind: COMPLETION_PRESETS.find((c) => c.label === label)?.kind || 'unsupported',
  }));
}
export function evaluateCompletion(p: Project): CompletionEvaluation {
  const criteria = (p.plan.criteria || compileCriteria(p.plan.completionCriteria)).map((c) => {
    let passed = false;
    let reason = '';
    if (c.kind === 'fields_complete') {
      const missing = p.plan.entities.flatMap((e) =>
        p.plan.years.flatMap((year) =>
          requiredFields(p.plan).filter(
            (field) =>
              !p.evidence.some(
                (v) =>
                  v.entity === e.name && v.year === year && v.field === field && v.value != null,
              ),
          ),
        ),
      );
      passed = !missing.length;
      reason = passed
        ? '所选指标的必需字段齐全'
        : `缺少必需字段：${[...new Set(missing)].join('、')}`;
    } else if (c.kind === 'calculation_lineage') {
      const calculations = p.evidence.filter((e) => e.type === 'calculation');
      const required = p.plan.entities.flatMap((e) =>
        p.plan.years.flatMap((year) =>
          requiredFields(p.plan).map((field) => ({ entity: e.name, year, field })),
        ),
      );
      passed =
        required.every((x) =>
          p.evidence.some(
            (e) =>
              e.entity === x.entity && e.year === x.year && e.field === x.field && e.value != null,
          ),
        ) &&
        calculations.every(
          (e) =>
            e.inputIds.length > 0 &&
            e.inputIds.every((id) => p.evidence.some((x) => x.id === id && x.value != null)),
        );
      reason = passed ? '已有计算的输入依赖可追溯' : '计算依赖不完整';
    } else if (c.kind === 'claims_typed') {
      passed = !!p.report?.claims.every((c) =>
        ['fact', 'inference', 'hypothesis'].includes(c.kind),
      );
      reason = passed ? '事实、归纳与假设已分类' : '尚未形成结构化判断';
    } else if (c.kind === 'counterchecks') {
      const core = p.report?.claims.filter((c) => c.core) || [];
      passed =
        !p.plan.includeFilings ||
        (!core.length
          ? p.plan.entities.every((e) =>
              p.evidence.some((x) => x.type === 'excerpt' && x.entity === e.code),
            )
          : core.every((c) =>
              p.plan.entities.every((e) =>
                p.counterChecks?.some(
                  (x) => x.claimId === c.id && x.entity === e.code && x.status === 'checked',
                ),
              ),
            ));
      reason = !p.plan.includeFilings
        ? '本计划未授权原文核查，持续性不作判断'
        : passed
          ? '已记录核心判断的核查范围与材料关系；不代表覆盖所有反证'
          : '核心判断的材料核查尚未完成';
    } else reason = '当前注册工具不能检查这项要求，不能标记达成';
    return { ...c, status: passed ? ('met' as const) : ('unresolved' as const), reason };
  });
  return {
    executionFinished: p.tasks.every((t) => !['queued', 'running'].includes(t.status)),
    outcome: criteria.every((c) => c.status === 'met') && !p.gaps.length ? 'met' : 'partial',
    criteria,
    evaluatedAt: new Date().toISOString(),
  };
}
