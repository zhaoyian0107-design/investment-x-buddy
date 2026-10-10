export type RunStatus =
  | 'draft'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'budget_exceeded';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
export type Metric = 'revenue' | 'netProfit' | 'operatingCashflow' | 'cashConversion';
export type Fault =
  | 'none'
  | 'filings_timeout'
  | 'financial_missing'
  | 'unit_conflict'
  | 'model_failure'
  | 'interrupt_once'
  | 'stale_data';
export interface Entity {
  code: string;
  name: string;
}
export interface Budget {
  maxModelCalls: number;
  maxToolCalls: number;
  maxSeconds: number;
}
export interface Plan {
  criteria?: CompletionCriterion[];
  adaptivePolicy?: { maxRounds: number; maxTasks: number };
  version: number;
  title: string;
  question: string;
  entities: Entity[];
  years: number[];
  metrics: Metric[];
  asOf: string;
  includeFilings: boolean;
  rationale: string;
  completionCriteria: string[];
}
export interface Task {
  retryBase?: number;
  id: string;
  tool: string;
  label: string;
  status: TaskStatus;
  entity?: Entity;
  dependencies: string[];
  attempts: number;
  durationMs: number;
  error?: string;
  result?: unknown;
  startedAt?: string;
  endedAt?: string;
}
export interface FinancialRow {
  code: string;
  name: string;
  year: number;
  period: 'annual';
  currency: 'CNY';
  unit: 'yuan';
  revenue: number | null;
  netProfit: number | null;
  operatingCashflow: number | null;
  publishedAt: string;
  retrievedAt: string;
  source: string;
  sourceUrl?: string;
  sourceRecordId: string;
  mode: 'demo' | 'live';
  sourceUrls?: Partial<Record<'revenue' | 'netProfit' | 'operatingCashflow', string>>;
  fieldPublishedAt?: Partial<Record<'revenue' | 'netProfit' | 'operatingCashflow', string>>;
  rawTransport?: {
    income?: { body: string; url: string; requestId: string };
    cashflow?: { body: string; url: string; requestId: string };
  };
  rawSource?: { income: Record<string, unknown>; cashflow: Record<string, unknown> };
}
export interface Filing {
  code: string;
  title: string;
  publishedAt: string;
  text: string;
  source: string;
  sourceUrl?: string;
  sourceRecordId: string;
  mode: 'demo' | 'live';
}
export interface Evidence {
  contentHash?: string;
  snapshotId?: string;
  snapshotHash?: string;
  planVersion?: number;
  locator?: string;
  formulaKey?: 'cash_conversion' | 'growth';
  algorithmVersion?: string;
  id: string;
  type: 'field' | 'calculation' | 'excerpt';
  label: string;
  entity: string;
  year?: number;
  field?: string;
  value?: number | null;
  unit: string;
  source: string;
  sourceRecordId: string;
  sourceUrl?: string;
  publishedAt: string;
  retrievedAt: string;
  raw: unknown;
  formula?: string;
  inputIds: string[];
  mode: 'demo' | 'live';
  caveats: string[];
}
export interface Claim {
  core?: boolean;
  revision?: number;
  validation?: {
    references: 'pass' | 'fail';
    numeric: 'pass' | 'fail' | 'not_applicable';
    semantic: 'deterministic' | 'needs_review';
  };
  id: string;
  kind: 'fact' | 'inference' | 'hypothesis';
  text: string;
  supportIds: string[];
  counterIds: string[];
  limitations: string[];
  confidence: 'supported' | 'limited' | 'unknown';
  verified: boolean;
}
export interface Report {
  title: string;
  summary: string;
  claims: Claim[];
  counterEvidence: string[];
  gaps: string[];
  nextQuestions: string[];
  createdAt: string;
  mode: 'demo' | 'live';
  modelMode: 'demo' | 'live' | 'fallback';
  validation: {
    referencesValid: boolean | CheckStatus;
    calculationChecked: boolean | CheckStatus;
    complianceChecked: boolean | CheckStatus;
    semanticSupport?: 'needs_review';
    removedClaims: number;
  };
}
export type CheckStatus = 'pass' | 'fail' | 'not_checked' | 'not_applicable';
export interface Event {
  id: number;
  at: string;
  type: string;
  message: string;
  detail?: unknown;
}
export interface Checkpoint {
  id: string;
  at: string;
  taskId: string;
  planVersion: number;
  completedTaskIds: string[];
  evidenceIds: string[];
}
export interface ContextSummary {
  planVersion?: number;
  recentMessages?: Message[];
  userCorrections?: { messageId: string; text: string; source: 'user'; status: 'unverified' }[];
  confirmedFacts?: { text: string; evidenceIds: string[] }[];
  currentJudgments?: {
    id: string;
    text: string;
    kind: string;
    evidenceIds: string[];
    validation?: Claim['validation'];
  }[];
  revisedHypotheses?: { claimId: string; before: string; after: string; checkIds: string[] }[];
  version: number;
  goal: string;
  constraints: string[];
  evidenceIds: string[];
  completed: string[];
  openQuestions: string[];
  nextTask: string | null;
  beforeChars: number;
  afterChars: number;
  createdAt: string;
}
export interface Message {
  planVersion?: number;
  requestId?: string;
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  evidenceIds: string[];
  modelMode?: string;
}
export interface Approval {
  id: string;
  type: 'initial' | 'expand';
  planHash: string;
  planVersion: number;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  expiresAt: string;
  budget: Budget;
  approvedAt?: string;
  returnStatus?: RunStatus;
}
export interface Usage {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  elapsedMs: number;
  unknownUsageCalls: number;
}
export interface Project {
  legacy?: boolean;
  legacyUsage?: Usage;
  counterChecks?: CounterCheck[];
  claimRevisions?: {
    claimId: string;
    at: string;
    before: Claim;
    after: Claim;
    checkIds: string[];
  }[];
  archivedEvidence?: Evidence[];
  completion?: CompletionEvaluation;
  schemaVersion?: number;
  ledgerBaseUsage?: Usage;
  calls?: CallRecord[];
  planningAllowance?: number;
  id: string;
  owner: string;
  revision: number;
  title: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  plan: Plan;
  tasks: Task[];
  evidence: Evidence[];
  report?: Report;
  events: Event[];
  checkpoints: Checkpoint[];
  context?: ContextSummary;
  messages: Message[];
  approvals: Approval[];
  budget: Budget;
  usage: Usage;
  fault: Fault;
  faultConsumed: boolean;
  dataMode: 'demo' | 'live';
  planningMode: 'demo' | 'live' | 'fallback';
  preferences: string[];
  gaps: string[];
  runStartedAt?: string;
  nextEventId: number;
  history?: {
    at: string;
    plan: Plan;
    tasks: Task[];
    evidence: Evidence[];
    report?: Report;
    checkpoints: Checkpoint[];
    counterChecks?: CounterCheck[];
    claimRevisions?: Project['claimRevisions'];
    completion?: CompletionEvaluation;
    context?: ContextSummary;
  }[];
}
export interface CounterCheck {
  id: string;
  claimId: string;
  entity: string;
  question: string;
  condition: string;
  status: 'checked' | 'unavailable' | 'not_applicable';
  findings: {
    evidenceId: string;
    relation: 'supports' | 'contradicts' | 'limits' | 'irrelevant';
    quote: string;
    locator: string;
    reason: string;
    assessment: 'rule_demo' | 'model_assessed';
  }[];
  coverage: {
    query: string;
    asOf: string;
    source: string;
    recordsReviewed: number;
    recordsRetrieved?: number;
  };
  limitations: string[];
  at: string;
}
export interface SourceSnapshot {
  id: string;
  projectId: string;
  hash: string;
  body: unknown;
  capturedAt: string;
  source: string;
  sourceRecordId: string;
  mode: 'demo' | 'live';
}
export interface CompletionCriterion {
  id: string;
  label: string;
  required: boolean;
  kind:
    'fields_complete' | 'calculation_lineage' | 'claims_typed' | 'counterchecks' | 'unsupported';
}
export const COMPLETION_PRESETS = [
  { label: '所选指标的必需字段齐全', kind: 'fields_complete' },
  { label: '核心指标可回到原始字段与计算依赖', kind: 'calculation_lineage' },
  { label: '每条判断标明事实、归纳或假设', kind: 'claims_typed' },
  { label: '记录反证、数据缺口和继续研究问题', kind: 'counterchecks' },
] as const;
export interface CompletionEvaluation {
  executionFinished: boolean;
  outcome: 'met' | 'partial';
  criteria: (CompletionCriterion & { status: 'met' | 'unresolved'; reason: string })[];
  evaluatedAt: string;
}
export interface CallInput {
  projectId: string;
  planVersion: number;
  key: string;
  kind: 'tool' | 'model';
  purpose: string;
  mode: 'demo' | 'live';
  taskId?: string;
  planning?: boolean;
}
export interface CallRecord extends CallInput {
  inputChars?: number;
  id: string;
  state: 'reserved' | 'started' | 'succeeded' | 'failed' | 'unknown' | 'released';
  reservedAt: string;
  startedAt?: string;
  endedAt?: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  usageKnown?: boolean;
  durationMs?: number;
  error?: string;
}
export interface Memory {
  id: string;
  owner: string;
  text: string;
  kind: 'preference' | 'hypothesis';
  createdAt: string;
  projectId?: string;
}
export interface Capability {
  name: string;
  label: string;
  description: string;
  permission: string;
  timeoutMs: number;
  available: boolean;
}
export const STATUS_LABELS: Record<RunStatus, string> = {
  draft: '计划待确认',
  running: '研究进行中',
  awaiting_approval: '等待确认',
  paused: '已暂停',
  blocked: '需要处理',
  completed: '研究已完成',
  partial: '部分成果',
  cancelled: '已取消',
  budget_exceeded: '预算已用尽',
};
export const METRIC_LABELS: Record<Metric, string> = {
  revenue: '营业收入',
  netProfit: '归母净利润',
  operatingCashflow: '经营现金流',
  cashConversion: '现金利润比',
};
