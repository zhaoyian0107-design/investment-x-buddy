import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Plan,
  Project,
  Task,
  Evidence,
  FinancialRow,
  Filing,
  Claim,
  Report,
  Budget,
  ContextSummary,
  Entity,
} from '../shared/types.ts';
import { METRIC_LABELS } from '../shared/types.ts';
import { canonical } from '../shared/canonical.ts';
import { shanghaiDate } from '../shared/dates.ts';
import { requiredFields, compileCriteria } from './planning.ts';
import { sealEvidence, findField } from './evidence.ts';
import { safeNarrative, claimValidation, validateReport } from './claims.ts';
import { semanticContext } from './context.ts';
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const DEFAULT_BUDGET: Budget = { maxModelCalls: 6, maxToolCalls: 12, maxSeconds: 180 };
export const DEMO_ENTITIES: Entity[] = [
  { code: '000333.SZ', name: '美的集团' },
  { code: '000651.SZ', name: '格力电器' },
  { code: '600690.SH', name: '海尔智家' },
];
export const DEFAULT_GOAL =
  '比较美的集团与格力电器最近两个可比年度报告期：利润有多少经营现金流支撑？找出变化、反证与值得继续核查的问题。';
export const planInputSchema = z.object({
  title: z.string().min(2).max(80),
  entities: z
    .array(z.object({ code: z.string().max(32), name: z.string().min(1).max(40) }))
    .min(1)
    .max(3),
  years: z.array(z.number().int().min(2000).max(2100)).min(1).max(3),
  metrics: z
    .array(z.enum(['revenue', 'netProfit', 'operatingCashflow', 'cashConversion']))
    .min(1)
    .max(4),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeFilings: z.boolean(),
  rationale: z.string().min(1).max(1000),
  completionCriteria: z.array(z.string().max(200)).min(1).max(6),
});
export function guardRequest(text: string) {
  if (
    /(保证收益|收益承诺|稳赚|一定涨|必涨|必跌|保证.{0,5}盈利|仓位建议|买卖建议|推荐.{0,8}(买入|卖出)|该不该.{0,5}(买|卖)|应该.{0,6}(买入|卖出|加仓|减仓)|帮我.{0,5}(买入|卖出)|目标价)/i.test(
      text,
    ) &&
    !/(不提供|不作|不要|不需要).{0,5}(买卖建议|仓位建议|收益承诺)/.test(text)
  )
    throw new Error(
      '此工作台用于证据研究，不提供直接买卖、仓位、确定性预测或收益承诺。请改为研究经营变化、证据和风险变量。',
    );
}
export function validatePlan(
  input: unknown,
  goal: string,
  mode: 'demo' | 'live',
  version = 1,
): Plan {
  const p = planInputSchema.parse(input);
  if (new Set(p.entities.map((e) => e.code)).size !== p.entities.length)
    throw new Error('研究对象不能重复');
  if (new Set(p.years).size !== p.years.length) throw new Error('报告期不能重复');
  if (p.years.some((y) => y >= Number(p.asOf.slice(0, 4))))
    throw new Error('年度报告期必须早于研究截止年份，并在截止日前公开');
  if (Number.isNaN(Date.parse(p.asOf)) || new Date(p.asOf).toISOString().slice(0, 10) !== p.asOf)
    throw new Error('研究截止日期无效');
  if (p.asOf > shanghaiDate(now())) throw new Error('研究截止日不能晚于今天');
  if (
    mode === 'demo' &&
    (p.years.some((y) => ![2023, 2024].includes(y)) ||
      p.entities.some((e) => !DEMO_ENTITIES.some((x) => x.code === e.code && x.name === e.name)))
  )
    throw new Error(
      '演示模式仅支持已标注的三家公司与2023、2024年构造样本；其他对象需要真实数据接入',
    );
  return {
    ...p,
    metrics: [...new Set(p.metrics)],
    years: [...p.years].sort(),
    version,
    question: goal,
    criteria: compileCriteria(p.completionCriteria),
    adaptivePolicy: { maxRounds: 1, maxTasks: 2 },
  };
}
export function demoPlan(goal: string, mode: 'demo' | 'live'): Plan {
  const selected = DEMO_ENTITIES.filter((e) => goal.includes(e.name));
  if (mode === 'live' && selected.length === 0)
    throw new Error('请明确输入公司名称；真实模式的自由对象规划需要配置模型');
  if (mode === 'demo' && selected.length === 0 && !/(比较|研究|经营|利润|现金|家电)/.test(goal))
    throw new Error('当前演示能力聚焦公司经营质量，请选择示例或明确已支持的公司');
  const entities = selected.length ? selected : DEMO_ENTITIES.slice(0, 2);
  const extracted = [...goal.matchAll(/20\d{2}/g)].map((m) => Number(m[0]));
  const years = extracted.length ? [...new Set(extracted)].slice(0, 3) : [2023, 2024];
  const metrics = goal.includes('只看收入')
    ? (['revenue'] as const)
    : goal.includes('现金')
      ? (['netProfit', 'operatingCashflow', 'cashConversion'] as const)
      : (['revenue', 'netProfit', 'operatingCashflow', 'cashConversion'] as const);
  return validatePlan(
    {
      title: `${entities.map((e) => e.name).join(' × ')} · 经营质量`,
      entities,
      years,
      metrics: [...metrics],
      asOf: mode === 'demo' ? '2025-04-30' : shanghaiDate(now()),
      includeFilings: !goal.includes('不查公告'),
      rationale:
        '先对齐年度报告期和人民币元口径，再计算利润的现金支撑；用已公开材料检查可比性与替代解释。',
      completionCriteria: [
        '所选指标的必需字段齐全',
        '核心指标可回到原始字段与计算依赖',
        '每条判断标明事实、归纳或假设',
        '记录反证、数据缺口和继续研究问题',
      ],
    },
    goal,
    mode,
  );
}
export function buildTasks(plan: Plan): Task[] {
  const make = (
    id: string,
    tool: string,
    label: string,
    dependencies: string[],
    entity?: Entity,
  ): Task => ({
    id: `v${plan.version}-${id}`,
    tool,
    label,
    status: 'queued',
    dependencies: dependencies.map((x) => `v${plan.version}-${x}`),
    entity,
    attempts: 0,
    durationMs: 0,
  });
  const tasks = [make('resolve', 'resolve_entities', '核对研究对象与数据能力', [])];
  for (const [i, e] of plan.entities.entries())
    tasks.push(make(`finance-${i}`, 'fetch_financials', `获取${e.name}财务数据`, ['resolve'], e));
  if (plan.includeFilings)
    for (const [i, e] of plan.entities.entries())
      tasks.push(make(`filing-${i}`, 'fetch_filings', `核查${e.name}公开材料`, ['resolve'], e));
  const finance = plan.entities.map((_, i) => `finance-${i}`);
  tasks.push(make('calculate', 'calculate_metrics', '对齐口径并计算指标', finance));
  tasks.push(
    make('claims', 'form_claims', '形成事实与待核查判断', [
      ...finance,
      'calculate',
      ...(plan.includeFilings ? plan.entities.map((_, i) => `filing-${i}`) : []),
    ]),
  );
  const checks: string[] = [];
  if (plan.includeFilings && plan.metrics.includes('cashConversion'))
    for (const [i, e] of plan.entities.slice(0, plan.adaptivePolicy?.maxTasks || 2).entries()) {
      checks.push(`counter-${i}`);
      tasks.push(
        make(`counter-${i}`, 'check_counterevidence', `核查${e.name}现金支撑假设`, ['claims'], e),
      );
    }
  tasks.push(make('report', 'build_report', '建立结论、反证与研究成果', ['claims', ...checks]));
  return tasks;
}
export function event(p: Project, type: string, message: string, detail?: unknown) {
  p.events.push({ id: p.nextEventId++, at: now(), type, message, detail });
}
export function approvalHash(plan: Plan, budget: Budget) {
  return createHash('sha256').update(canonical({ plan, budget })).digest('hex');
}
export function addApproval(p: Project, type: 'initial' | 'expand', message: string) {
  p.approvals.push({
    id: uid(),
    type,
    message,
    status: 'pending',
    planHash: approvalHash(p.plan, p.budget),
    planVersion: p.plan.version,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    budget: { ...p.budget },
  });
}
export function newProject(
  owner: string,
  goal: string,
  plan: Plan,
  dataMode: 'demo' | 'live',
  planningMode: Project['planningMode'],
  preferences: string[] = [],
): Project {
  const p: Project = {
    schemaVersion: 2,
    planningAllowance: 1,
    ledgerBaseUsage: {
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      elapsedMs: 0,
      unknownUsageCalls: 0,
    },
    id: uid(),
    owner,
    revision: 0,
    title: plan.title,
    goal,
    createdAt: now(),
    updatedAt: now(),
    status: 'draft',
    plan,
    tasks: buildTasks(plan),
    evidence: [],
    events: [],
    checkpoints: [],
    messages: [],
    approvals: [],
    budget: { ...DEFAULT_BUDGET },
    usage: {
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      elapsedMs: 0,
      unknownUsageCalls: 0,
    },
    fault: 'none',
    faultConsumed: false,
    dataMode,
    planningMode,
    preferences,
    gaps: [],
    nextEventId: 1,
  };
  p.messages.push({ id: uid(), role: 'user', text: goal, at: now(), evidenceIds: [] });
  event(
    p,
    'plan.created',
    planningMode === 'live'
      ? '模型已建立受约束的研究计划'
      : '已建立规则规划的研究计划；当前未使用真实模型',
    { planVersion: 1 },
  );
  addApproval(p, 'initial', '确认研究对象、截止时点与调用预算后，开始只读研究。');
  return p;
}
export function fieldEvidence(row: FinancialRow): Evidence[] {
  return (['revenue', 'netProfit', 'operatingCashflow'] as const)
    .map((field) => ({
      id: `${row.code}:${row.year}:${field}`,
      type: 'field',
      label: METRIC_LABELS[field],
      entity: row.name,
      year: row.year,
      field,
      value: row[field],
      unit: 'CNY yuan',
      source: row.source,
      sourceRecordId: row.sourceRecordId,
      sourceUrl: row.sourceUrls?.[field] || row.sourceUrl,
      publishedAt: row.fieldPublishedAt?.[field] || row.publishedAt,
      retrievedAt: row.retrievedAt,
      raw: row,
      inputIds: [],
      mode: row.mode,
      caveats: row[field] === null ? ['原始字段缺失'] : [],
      locator: row.rawSource
        ? `rawSource.${field === 'operatingCashflow' ? 'cashflow.act_cash_flow_net' : field === 'revenue' ? 'income.operating_income' : 'income.parent_holder_net_profit'}`
        : field,
    }))
    .map((e) => sealEvidence(e as Evidence, 1));
}
export function filingEvidence(f: Filing, planVersion = 1): Evidence {
  return sealEvidence(
    {
      id: `filing:${f.code}:${f.sourceRecordId}`,
      type: 'excerpt',
      label: f.title,
      entity: f.code,
      unit: '原文',
      source: f.source,
      sourceRecordId: f.sourceRecordId,
      sourceUrl: f.sourceUrl,
      publishedAt: f.publishedAt,
      retrievedAt: now(),
      raw: f.text,
      inputIds: [],
      mode: f.mode,
      caveats: ['检索到的材料不代表完整覆盖；未检索到反证不等于不存在反证'],
      locator: `正文字符 0–${f.text.length}`,
    },
    planVersion,
  );
}
export function calculate(
  plan: Plan,
  evidence: Evidence[],
): { evidence: Evidence[]; gaps: string[] } {
  const derived: Evidence[] = [];
  const gaps: string[] = [];
  for (const e of plan.entities)
    for (const year of plan.years) {
      if (!plan.metrics.includes('cashConversion')) continue;
      const profit = findField(evidence, e.name, year, 'netProfit');
      const cash = findField(evidence, e.name, year, 'operatingCashflow');
      if (!profit || !cash || profit.value == null || cash.value == null) {
        gaps.push(`${e.name} ${year}年现金利润比缺少原始字段`);
        continue;
      }
      const applicable = profit.value > 0;
      derived.push({
        id: `${e.code}:${year}:cashConversion`,
        type: 'calculation',
        label: '现金利润比',
        entity: e.name,
        year,
        field: 'cashConversion',
        value: applicable ? cash.value / profit.value : null,
        unit: '倍',
        source: '确定性计算',
        sourceRecordId: `calc:${e.code}:${year}`,
        publishedAt: profit.publishedAt > cash.publishedAt ? profit.publishedAt : cash.publishedAt,
        retrievedAt: now(),
        raw: { operatingCashflow: cash.value, netProfit: profit.value },
        formula: '经营活动现金流净额 ÷ 归属于母公司股东的净利润',
        formulaKey: 'cash_conversion',
        algorithmVersion: '1',
        inputIds: [cash.id, profit.id],
        mode: profit.mode,
        caveats: applicable
          ? ['比值受营运资本、季节性与业务结构影响，不能直接作为公司排名']
          : ['净利润非正，普通现金利润比不适用'],
      });
    }
  for (const e of plan.entities)
    for (const field of requiredFields(plan)) {
      if (plan.years.length < 2) continue;
      const current = findField(evidence, e.name, plan.years.at(-1)!, field);
      const prior = findField(evidence, e.name, plan.years.at(-2)!, field);
      if (!current || !prior || current.value == null || prior.value == null) continue;
      derived.push({
        id: `${e.code}:${current.year}:${field}Growth`,
        type: 'calculation',
        label: `${METRIC_LABELS[field]}变化率`,
        entity: e.name,
        year: current.year,
        field: `${field}Growth`,
        value: prior.value > 0 ? (current.value - prior.value) / prior.value : null,
        unit: 'ratio',
        source: '确定性计算',
        sourceRecordId: `calc:${e.code}:${field}:growth`,
        publishedAt: current.publishedAt,
        retrievedAt: now(),
        raw: { current: current.value, prior: prior.value },
        formula: '(本期值 − 上期值) ÷ 上期值；上期值必须为正',
        formulaKey: 'growth',
        algorithmVersion: '1',
        inputIds: [current.id, prior.id],
        mode: current.mode,
        caveats: prior.value <= 0 ? ['前期非正，普通增长率不适用'] : [],
      });
    }
  return { evidence: derived.map((e) => sealEvidence(e, plan.version)), gaps };
}
export function formatValue(e: Evidence) {
  if (e.value == null) return '不可计算';
  if (e.unit === 'ratio') return `${(e.value * 100).toFixed(2)}%`;
  if (e.unit === '倍') return `${e.value.toFixed(2)}倍`;
  return `${(e.value / 1e8).toFixed(2)}亿元`;
}
export function baseReport(p: Project, modelMode: Report['modelMode']): Report {
  const claims: Claim[] = [];
  for (const e of p.evidence.filter(
    (x) => x.type !== 'excerpt' && p.plan.metrics.includes(x.field as any) && x.value != null,
  ))
    claims.push({
      id: `fact-${e.id}`,
      kind: 'fact',
      text: `${e.entity} ${e.year}年${e.label}为${formatValue(e)}。`,
      supportIds: [e.id],
      counterIds: [],
      limitations: e.caveats,
      confidence: 'supported',
      verified: true,
    });
  const ratio = p.evidence.filter(
    (e) => e.field === 'cashConversion' && e.year === p.plan.years.at(-1) && e.value != null,
  );
  if (ratio.length)
    claims.push({
      id: `hypothesis-cash-v${p.plan.version}`,
      core: p.plan.includeFilings,
      kind: p.plan.includeFilings ? 'hypothesis' : 'inference',
      text: p.plan.includeFilings
        ? '待核查：较高现金利润比是否意味着经营质量持续改善？'
        : '现金利润比提供利润现金支撑的一个观察维度；持续性和整体经营质量尚未核查。',
      supportIds: ratio.map((e) => e.id),
      counterIds: [],
      limitations: ['业务结构与营运资本变化尚需核查', '年末现金流不能代表每个季度'],
      confidence: 'limited',
      verified: false,
    });
  const gaps = [
    ...new Set([
      ...p.gaps,
      ...p.evidence
        .filter(
          (e) =>
            e.type === 'field' &&
            e.value == null &&
            requiredFields(p.plan).includes(e.field as any),
        )
        .map((e) => `${e.entity} ${e.year}年${e.label}缺失`),
    ]),
  ];
  const report: Report = {
    title: p.title,
    summary:
      p.dataMode === 'demo'
        ? '此成果基于明确标注的构造样本，用于验证研究流程。事实可回到字段，解释保留边界，不代表真实公司情况。'
        : '已按已公开年度数据建立研究账本；请结合证据完整性与可比性阅读判断。',
    claims,
    counterEvidence: [],
    gaps,
    nextQuestions: [
      '现金流变化是否主要来自应收账款、存货或应付款变化？',
      '分季度数据是否支持年度观察，是否存在明显季节性？',
      '两家公司的业务结构差异对可比性影响有多大？',
    ],
    createdAt: now(),
    mode: p.dataMode,
    modelMode,
    validation: {
      referencesValid: true,
      calculationChecked: true,
      complianceChecked: true,
      removedClaims: 0,
    },
  };
  report.claims = report.claims.map((c) => ({
    ...c,
    revision: 1,
    validation: claimValidation(c, p.evidence),
  }));
  report.validation = validateReport(report, p.evidence);
  return report;
}
export function verifyClaims(
  claims: Claim[],
  evidence: Evidence[],
): { claims: Claim[]; removed: number } {
  const ids = new Set(evidence.map((e) => e.id));
  let removed = 0;
  const valid = claims.filter((c) => {
    const ok =
      c.supportIds.length > 0 &&
      [...c.supportIds, ...c.counterIds].every((id) => ids.has(id)) &&
      !/(建议.{0,5}(买入|卖出|加仓|减仓)|保证收益|稳赚|必涨|必跌|目标价|仓位建议)/.test(c.text) &&
      (c.kind === 'fact'
        ? c.supportIds.length === 1 &&
          evidence.some(
            (e) =>
              e.id === c.supportIds[0] &&
              c.text === `${e.entity} ${e.year}年${e.label}为${formatValue(e)}。`,
          )
        : safeNarrative(c.text));
    if (!ok) removed++;
    return ok;
  });
  return {
    claims: valid.map((c) => ({
      ...c,
      verified: c.kind === 'fact',
      validation: claimValidation(c, evidence),
      confidence: c.kind === 'fact' ? 'supported' : c.confidence,
    })),
    removed,
  };
}
export function compact(p: Project): ContextSummary {
  const beforeChars = JSON.stringify({
    messages: p.messages,
    evidence: p.evidence,
    events: p.events,
    plan: p.plan,
  }).length;
  const summary: ContextSummary = {
    ...semanticContext(p),
    version: (p.context?.version || 0) + 1,
    goal: p.goal,
    constraints: [
      `数据模式：${p.dataMode}`,
      `截止：${p.plan.asOf}`,
      `报告期：${p.plan.years.join('、')}`,
      `仅只读研究；区分事实、归纳、假设；不得给买卖或仓位建议`,
      ...p.preferences,
    ],
    evidenceIds: p.evidence.map((e) => e.id),
    completed: p.tasks.filter((t) => t.status === 'done').map((t) => t.id),
    openQuestions: [...new Set([...p.gaps, ...(p.report?.nextQuestions || [])])],
    nextTask: p.tasks.find((t) => t.status === 'queued')?.id || null,
    beforeChars,
    afterChars: 0,
    createdAt: now(),
  };
  summary.afterChars = JSON.stringify(summary).length;
  return summary;
}
export function exportMarkdown(p: Project) {
  const r = p.report;
  if (!r) return `# ${p.title}\n\n状态：${p.status}\n\n尚无成果。`;
  return [
    `# ${r.title}`,
    `数据：${p.dataMode === 'demo' ? '构造演示样本，不代表实际财报' : '真实数据'}；模型：${r.modelMode}；截止：${p.plan.asOf}`,
    r.summary,
    '## 研究判断',
    ...r.claims.map(
      (c) =>
        `- **${{ fact: '事实', inference: '归纳', hypothesis: '假设' }[c.kind]}** ${c.text}\n  支持：${c.supportIds.join('；')}\n  反向或限制材料：${c.counterIds.join('；') || '未确认'}\n  边界：${c.limitations.join('；') || '详见证据'}`,
    ),
    '## 反证与局限',
    ...r.counterEvidence.map((s) => `- ${s}`),
    '## 数据缺口',
    ...(r.gaps.length ? r.gaps : ['已检查字段未发现缺失；这不代表全部研究证据完整']).map(
      (s) => `- ${s}`,
    ),
    '## 继续研究',
    ...r.nextQuestions.map((s) => `- ${s}`),
    '## 证据索引',
    ...p.evidence.map(
      (e) =>
        `- ${e.id}｜${e.source}｜${e.sourceRecordId}｜公开：${e.publishedAt}｜采集：${e.retrievedAt}｜单位：${e.unit}｜原始数值：${e.value ?? '不适用'}｜${e.formula || e.field || '原文'}\n  输入：${e.inputIds.join('；') || '原始记录'}\n  内容哈希：${e.contentHash || '历史记录未校验'}${e.type === 'excerpt' ? `\n  定位：${e.locator || '未提供'}\n  原文：${String(e.raw)}` : ''}${e.sourceUrl ? `\n  来源：${e.sourceUrl}` : ''}`,
    ),
    '\n用途：投资研究，不提供确定性预测、收益承诺或直接买卖建议。',
  ].join('\n\n');
}
