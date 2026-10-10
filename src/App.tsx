import { useEffect, useState, useRef, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  BookOpen,
  Calculator,
  Layers,
  Database,
  Settings2,
  Sparkles,
  CircleCheck,
  Circle,
  LoaderCircle,
  Pause,
  Play,
  X,
  Check,
  Download,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Clock3,
  Terminal,
  FileText,
  Brain,
  Link2,
  ListChecks,
  Coins,
  PanelRightClose,
  Trash2,
  Send,
  Activity,
  FlaskConical,
  CheckCheck,
  Quote,
  Lightbulb,
  Square,
  GitBranch,
} from 'lucide-react';
import type {
  Project,
  Evidence,
  Plan,
  Fault,
  Memory,
  Capability,
  Entity,
  Budget,
} from '../shared/types.ts';
import { METRIC_LABELS, STATUS_LABELS, COMPLETION_PRESETS } from '../shared/types.ts';
import { canonical } from '../shared/canonical.ts';
import {
  CompletionPanel,
  ValidationPanel,
  CounterPanel,
  RevisionsPanel,
  CallsPanel,
} from './AuditPanels.tsx';
type ProjectView = Omit<Project, 'owner'>;
interface Bootstrap {
  projects: Pick<Project, 'id' | 'title' | 'status' | 'updatedAt' | 'dataMode'>[];
  memories: Memory[];
  capabilities: Capability[];
  defaultGoal: string;
  entities: Entity[];
  config: {
    dataMode: string;
    modelMode: string;
    modelConfigured: boolean;
    gatewayConfigured: boolean;
    database: string;
    faultLab: boolean;
  };
}
async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error: any = new Error(value.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return value;
}
const time = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
const date = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
const amount = (e?: Evidence) =>
  e?.value == null
    ? '—'
    : e.unit === '倍'
      ? `${e.value.toFixed(2)} 倍`
      : e.unit === 'ratio'
        ? `${(e.value * 100).toFixed(2)}%`
        : `${(e.value / 1e8).toFixed(2)}`;
const faultLabels: Record<Fault, string> = {
  none: '正常研究',
  filings_timeout: '公告超时 → 重试与降级',
  financial_missing: '财务字段缺失 → 部分成果',
  unit_conflict: '单位冲突 → 阻止计算',
  model_failure: '模型失败 → 确定性降级',
  interrupt_once: '中途中断 → 检查点恢复',
  stale_data: '数据过期 → 显式缺口',
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <GitBranch size={22} />
      </span>
      <span>
        X <b>Buddy</b>
        <small>INVESTMENT RESEARCH</small>
      </span>
    </div>
  );
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <BookOpen size={27} />
      <p>{children}</p>
    </div>
  );
}
export function App() {
  const [boot, setBoot] = useState<Bootstrap>();
  const [project, setProject] = useState<ProjectView>();
  const [activeId, setActiveId] = useState<string | undefined>(
    () => window.location.hash.match(/^#research\/([a-f0-9-]{36})$/)?.[1],
  );
  const [section, setSection] = useState<'research' | 'memory' | 'tools'>('research');
  const [tab, setTab] = useState<'result' | 'plan' | 'log'>('result');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<Evidence>();
  const [settings, setSettings] = useState(false);
  const [login, setLogin] = useState(false);
  const [token, setToken] = useState('');
  const [memoryText, setMemoryText] = useState('');
  const [memoryKind, setMemoryKind] = useState<'preference' | 'hypothesis'>('preference');
  async function refresh() {
    const b = await api<Bootstrap>('/bootstrap');
    setBoot(b);
    return b;
  }
  useEffect(() => {
    refresh().catch((e) => (e.status === 401 ? setLogin(true) : setError(e.message)));
  }, []);
  useEffect(() => {
    window.history.replaceState(
      null,
      '',
      activeId ? `#research/${activeId}` : window.location.pathname,
    );
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return;
    let active = true;
    api<ProjectView>(`/projects/${activeId}`)
      .then((p) => {
        if (active) setProject(p);
      })
      .catch((e) => setError(e.message));
    const source = new EventSource(`/api/projects/${activeId}/events`);
    source.addEventListener('project', (event) => {
      if (active) {
        const p = JSON.parse((event as MessageEvent).data) as ProjectView;
        setProject(p);
        setBoot((b) =>
          b
            ? {
                ...b,
                projects: b.projects.map((x) =>
                  x.id === p.id
                    ? { ...x, title: p.title, status: p.status, updatedAt: p.updatedAt }
                    : x,
                ),
              }
            : b,
        );
      }
    });
    return () => {
      active = false;
      source.close();
    };
  }, [activeId]);
  useEffect(() => {
    if (project && evidence) {
      const current = project.evidence.find((e) => e.id === evidence.id);
      if (current) setEvidence(current);
      // Immutable historical evidence remains readable after a new snapshot arrives.
    }
  }, [project?.revision]);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setEvidence(undefined);
        setSettings(false);
      }
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    if (!evidence && !settings) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,textarea,select,summary,[tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [Boolean(evidence), settings]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(id: string) {
    setActiveId(id);
    setProject(undefined);
    setSection('research');
    setTab('result');
    setEvidence(undefined);
  }
  function startNew() {
    setActiveId(undefined);
    setProject(undefined);
    setSection('research');
    setGoal('');
    setEvidence(undefined);
    void refresh();
  }
  async function create(input = goal) {
    await perform(async () => {
      const p = await api<ProjectView>('/projects', { goal: input || boot?.defaultGoal });
      setProject(p);
      setActiveId(p.id);
      setTab('plan');
      await refresh();
    });
  }
  async function action(action: string) {
    if (!project) return;
    await perform(async () => {
      const p = await api<ProjectView>(`/projects/${project.id}/action`, { action });
      setProject(p);
      await refresh();
    });
  }
  const selectEvidence = (id: string) => {
    const e = project?.evidence.find((e) => e.id === id);
    if (e) setEvidence(e);
    else if (project)
      void api<Evidence>(`/projects/${project.id}/evidence/${encodeURIComponent(id)}`)
        .then(setEvidence)
        .catch((e) => setError(e.message));
  };
  if (login)
    return (
      <main className="login">
        <Brand />
        <div className="card">
          <h1>进入你的研究工作台</h1>
          <p>此部署已启用访问保护。</p>
          <label htmlFor="access-token">部署访问口令</label>
          <input
            id="access-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api('/login', { token });
                setLogin(false);
                await refresh();
              })
            }
          >
            进入工作台 <ArrowRight size={16} />
          </button>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="研究空间导航">
        <Brand />
        <button className="new-research" onClick={startNew}>
          <Plus size={17} />
          新建研究<span>＋</span>
        </button>
        <nav aria-label="工作台导航">
          <button
            className={section === 'research' ? 'selected' : ''}
            onClick={() => {
              setSection('research');
              void refresh();
            }}
          >
            <Layers size={18} />
            研究工作台
            <ChevronRight size={14} />
          </button>
          <button
            className={section === 'memory' ? 'selected' : ''}
            onClick={() => {
              setSection('memory');
              void refresh();
            }}
          >
            <Brain size={18} />
            长期记忆<small>{boot?.memories.length || 0}</small>
          </button>
          <button
            className={section === 'tools' ? 'selected' : ''}
            onClick={() => setSection('tools')}
          >
            <Database size={18} />
            能力与数据
          </button>
        </nav>
        <div className="sidebar-section">
          <span>研究项目</span>
          <button aria-label="刷新项目列表" onClick={() => void refresh()}>
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="project-list">
          {boot?.projects.length ? (
            boot.projects.map((p) => (
              <button
                className={activeId === p.id && section === 'research' ? 'active' : ''}
                key={p.id}
                onClick={() => select(p.id)}
              >
                <FileText size={15} />
                <span>
                  <strong>{p.title}</strong>
                  <small>
                    <i className={`dot ${p.status}`} />
                    {STATUS_LABELS[p.status]} · {date(p.updatedAt)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">
              从一个值得研究的问题开始。
              <br />
              你的研究将在这里持续积累。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">研</div>
          <span>
            个人研究空间<small>独立会话 · 持久保存</small>
          </span>
          <button aria-label="打开设置" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            工作空间 <ChevronRight size={14} />
            <strong>
              {section === 'memory'
                ? '长期记忆'
                : section === 'tools'
                  ? '能力与数据'
                  : '研究工作台'}
            </strong>
          </div>
          <div className="topbar-right">
            <Badge tone={boot?.config.dataMode === 'live' ? 'green' : 'amber'}>
              <i className="dot" />
              {boot?.config.dataMode === 'live' ? '真实数据' : '构造数据演示'}
            </Badge>
            <button
              className="icon-button"
              aria-label="配置与运行环境"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>
        <main id="main">
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {!boot && !error ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在连接研究空间…
            </div>
          ) : section === 'memory' ? (
            <div className="page-content">
              <p className="eyebrow">PERSONAL CONTEXT</p>
              <h1>让研究积累下来。</h1>
              <p className="page-description">
                保存你确认的研究偏好和待核查假设。新项目会读取这些记忆；假设始终保留“待核查”身份。
              </p>
              <div className="card memory-form">
                <label htmlFor="memory-text">新增长期记忆</label>
                <textarea
                  id="memory-text"
                  placeholder="例如：优先看经营现金流，并始终展示反证。"
                  value={memoryText}
                  onChange={(e) => setMemoryText(e.target.value)}
                  maxLength={500}
                />
                <div className="form-footer">
                  <select
                    aria-label="记忆类型"
                    value={memoryKind}
                    onChange={(e) => setMemoryKind(e.target.value as any)}
                  >
                    <option value="preference">已确认偏好</option>
                    <option value="hypothesis">待核查假设</option>
                  </select>
                  <button
                    className="primary"
                    disabled={busy || memoryText.trim().length < 2}
                    onClick={() =>
                      void perform(async () => {
                        await api('/memories', {
                          text: memoryText,
                          kind: memoryKind,
                          projectId: activeId,
                        });
                        setMemoryText('');
                        await refresh();
                      })
                    }
                  >
                    <Check size={16} />
                    确认并保存
                  </button>
                </div>
              </div>
              <div className="memory-grid">
                {boot?.memories.length ? (
                  boot.memories.map((m) => (
                    <div className="card memory-card" key={m.id}>
                      <Badge tone={m.kind === 'hypothesis' ? 'amber' : 'green'}>
                        {m.kind === 'hypothesis' ? '待核查假设' : '已确认偏好'}
                      </Badge>
                      <p>{m.text}</p>
                      <div>
                        <small>
                          保存于 {date(m.createdAt)} · {time(m.createdAt)}
                        </small>
                        <button
                          aria-label="删除记忆"
                          onClick={() =>
                            void perform(async () => {
                              await api(`/memories/${m.id}`, {}, 'DELETE');
                              await refresh();
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty>还没有长期记忆。保存一条你愿意带入后续研究的偏好。</Empty>
                )}
              </div>
            </div>
          ) : section === 'tools' ? (
            <div className="page-content">
              <p className="eyebrow">CAPABILITIES & SOURCES</p>
              <h1>每一种能力，都有边界。</h1>
              <p className="page-description">
                工具在执行前注册、校验并接受预算约束。金融数据原文只作为研究证据。
              </p>
              <div className="source-banner">
                <Database size={23} />
                <div>
                  <b>
                    {boot?.config.dataMode === 'demo' ? '当前使用构造样本' : '当前使用真实数据网关'}
                  </b>
                  <p>
                    {boot?.config.dataMode === 'demo'
                      ? '支持三家示例公司及2023、2024年度。全部数字和材料均为构造数据，不代表实际财报。'
                      : '真实模式不会自动回退到演示财务数据；接口失败将显示明确缺口。'}
                  </p>
                </div>
              </div>
              <div className="tools-grid">
                {boot?.capabilities.map((c) => (
                  <div className="card tool-card" key={c.name}>
                    <div>
                      <span className="tool-icon">
                        <Terminal size={21} />
                      </span>
                      <Badge tone={c.available ? 'green' : 'amber'}>
                        {c.available ? '已注册' : '待配置'}
                      </Badge>
                    </div>
                    <h2>{c.label}</h2>
                    <code>{c.name}</code>
                    <p>{c.description}</p>
                    <footer>
                      <span>
                        {c.permission === 'read'
                          ? '只读数据'
                          : c.permission === 'model'
                            ? '模型调用'
                            : '本地执行'}
                      </span>
                      <span>超时 {c.timeoutMs / 1000}s</span>
                    </footer>
                  </div>
                ))}
              </div>
            </div>
          ) : !activeId ? (
            <div className="landing page-content">
              <div className="landing-heading">
                <div>
                  <p className="eyebrow">
                    <span /> YOUR PERSONAL RESEARCH AGENT
                  </p>
                  <h1>
                    让每一个判断，
                    <br />
                    都有据可循<span>。</span>
                  </h1>
                  <p>
                    从一个问题出发，建立计划、核查证据、沉淀研究。
                    <br />
                    过程可检查，工作可恢复，判断始终有边界。
                  </p>
                </div>
                <ResearchIllustration />
              </div>
              <div className="composer card">
                <div className="composer-label">
                  <Sparkles size={17} />
                  <span>今天，你想研究什么？</span>
                  <Badge>只读研究</Badge>
                </div>
                <textarea
                  aria-label="研究目标"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder={boot?.defaultGoal}
                  maxLength={1500}
                />
                <div className="composer-bottom">
                  <div>
                    <Database size={14} />
                    <span>
                      {boot?.config.dataMode === 'live'
                        ? '已配置数据网关'
                        : '构造样本 · 家电公司经营质量'}
                    </span>
                  </div>
                  <button className="primary" disabled={busy} onClick={() => void create()}>
                    {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                    建立研究计划
                  </button>
                </div>
              </div>
              <div className="suggestion-heading">
                <span>从一个具体问题开始</span>
                <small>选择后可修改研究范围</small>
              </div>
              <div className="suggestions">
                {[
                  {
                    icon: Activity,
                    title: '比较利润的现金支撑',
                    text: '美的集团 × 格力电器',
                    goal: boot?.defaultGoal || '',
                  },
                  {
                    icon: Search,
                    title: '深入一家公司的变化',
                    text: '海尔智家 · 经营质量',
                    goal: '研究海尔智家2023和2024年度经营质量：比较收入、利润与经营现金流的变化，并核查反证。',
                  },
                  {
                    icon: ShieldCheck,
                    title: '核查一个初步判断',
                    text: '从指标差异到替代解释',
                    goal: '比较美的集团与格力电器的经营现金流和现金利润比，核查为什么较高比值不足以证明经营质量更好。',
                  },
                ].map((s) => (
                  <button key={s.title} className="card suggestion" onClick={() => setGoal(s.goal)}>
                    <span className="suggestion-icon">
                      <s.icon size={20} />
                    </span>
                    <strong>{s.title}</strong>
                    <small>{s.text}</small>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              <div className="principles">
                {[
                  { icon: ListChecks, title: '先计划，再执行', text: '研究范围与完成标准由你确认' },
                  { icon: Link2, title: '结论回到证据', text: '原始字段、口径与计算可检查' },
                  { icon: RotateCcw, title: '中断也能继续', text: '任务与检查点持久保存' },
                  { icon: Brain, title: '研究逐步积累', text: '偏好和未解问题成为长期记忆' },
                ].map((x) => (
                  <div key={x.title}>
                    <x.icon size={18} />
                    <b>{x.title}</b>
                    <p>{x.text}</p>
                  </div>
                ))}
              </div>
              <p className="landing-note">
                <ShieldCheck size={14} />
                用于投资研究，不提供确定性预测、收益承诺或直接买卖建议。
              </p>
            </div>
          ) : !project ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在打开研究项目…
            </div>
          ) : (
            <div className="project-page page-content">
              {project.legacy && (
                <div className="info-box">
                  这是保留的第一版成果，尚未通过第二版验收。请在研究计划中修改并保存后，重新确认研究；历史材料和原版用量保留。
                </div>
              )}
              <div className="project-heading">
                <div>
                  <p className="eyebrow">
                    RESEARCH THREAD <span> / V{project.plan.version}</span>
                  </p>
                  <h1>{project.title}</h1>
                  <p>{project.goal}</p>
                </div>
                <div className="project-actions">
                  {project.report && (
                    <a className="secondary" href={`/api/projects/${project.id}/export`}>
                      <Download size={15} />
                      导出成果
                    </a>
                  )}
                  {project.report && (
                    <a className="secondary" href={`/api/projects/${project.id}/bundle`}>
                      <Download size={15} />
                      下载证据包
                    </a>
                  )}
                  {project.status === 'running' ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action('pause')}
                    >
                      <Pause size={15} />
                      暂停
                    </button>
                  ) : project.status === 'paused' ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action('resume')}
                    >
                      <Play size={15} />
                      继续研究
                    </button>
                  ) : ['partial', 'blocked'].includes(project.status) ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action('retry')}
                    >
                      <RotateCcw size={15} />
                      重试缺失任务
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className={`run-banner ${['partial', 'blocked', 'budget_exceeded'].includes(project.status) ? 'warning' : ''}`}
              >
                <div>
                  <span className="run-icon">
                    {project.status === 'running' ? (
                      <LoaderCircle className="spin" size={19} />
                    ) : ['completed', 'partial'].includes(project.status) ? (
                      <CheckCheck size={19} />
                    ) : (
                      <Clock3 size={19} />
                    )}
                  </span>
                  <span>
                    <b>{STATUS_LABELS[project.status]}</b>
                    <small>
                      {project.status === 'running'
                        ? project.tasks.find((t) => t.status === 'running')?.label ||
                          '正在准备下一项任务'
                        : project.status === 'draft'
                          ? '检查计划后确认，系统才会开始取数'
                          : project.status === 'paused'
                            ? '已提交结果保留，继续时从未完成任务恢复'
                            : project.status === 'budget_exceeded'
                              ? '已停止额外调用，阶段成果与证据保留'
                              : project.status === 'partial'
                                ? '部分证据缺失，请查看结果中的数据缺口'
                                : '任务状态与研究记录已保存'}
                    </small>
                  </span>
                </div>
                <span>
                  {project.tasks.filter((t) => t.status === 'done').length} / {project.tasks.length}{' '}
                  任务完成
                </span>
              </div>
              {project.dataMode === 'demo' && (
                <div className="demo-notice">
                  <FlaskConical size={15} />
                  构造样本：所有数字与文本均非实际财报；用于验证研究机制。
                  {project.fault !== 'none' && (
                    <strong>故障实验：{faultLabels[project.fault]}</strong>
                  )}
                </div>
              )}
              <div className="project-tabs" role="tablist" aria-label="研究视图">
                {[
                  { id: 'result', label: '研究成果', icon: BookOpen },
                  { id: 'plan', label: '研究计划', icon: ListChecks },
                  { id: 'log', label: '运行记录', icon: Terminal },
                ].map((t) => (
                  <button
                    role="tab"
                    aria-selected={tab === t.id}
                    className={tab === t.id ? 'active' : ''}
                    key={t.id}
                    onClick={() => setTab(t.id as any)}
                  >
                    <t.icon size={16} />
                    {t.label}
                    {t.id === 'log' && <small>{project.events.length}</small>}
                  </button>
                ))}
                <div>
                  <Badge tone={project.planningMode === 'live' ? 'green' : 'neutral'}>
                    {project.planningMode === 'live'
                      ? '模型规划'
                      : project.planningMode === 'fallback'
                        ? '规划已降级'
                        : '规则规划'}
                  </Badge>
                </div>
              </div>
              <div className="research-columns">
                <div className="research-main">
                  {tab === 'plan' ? (
                    <PlanEditor
                      p={project}
                      boot={boot!}
                      busy={busy}
                      perform={perform}
                      update={setProject}
                      onStart={() => setTab('result')}
                    />
                  ) : tab === 'log' ? (
                    <RunLog p={project} action={action} busy={busy} />
                  ) : project.report ? (
                    <ReportView p={project} selectEvidence={selectEvidence} />
                  ) : (
                    <div className="card waiting-report">
                      <span className="large-icon">
                        <BookOpen size={27} />
                      </span>
                      <h2>
                        {project.status === 'draft'
                          ? '好的研究，从一份清晰计划开始。'
                          : '研究成果正在建立。'}
                      </h2>
                      <p>
                        {project.status === 'draft'
                          ? '确认对象、报告期与指标后，系统会收集证据并生成可检查的成果。'
                          : '已经取得的证据会持续保存；你可以查看计划和运行记录。'}
                      </p>
                      <button className="secondary" onClick={() => setTab('plan')}>
                        <ListChecks size={16} />
                        查看研究计划
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  {project.evidence.length > 0 && tab === 'result' && (
                    <Followup
                      p={project}
                      busy={busy}
                      perform={perform}
                      update={setProject}
                      selectEvidence={selectEvidence}
                    />
                  )}
                </div>
                <aside className="research-side" aria-label="研究进度与证据索引">
                  <div className="card task-card">
                    <div className="card-heading">
                      <h3>研究进度</h3>
                      <span>
                        {Math.round(
                          (project.tasks.filter((t) => t.status === 'done').length /
                            project.tasks.length) *
                            100,
                        )}
                        %
                      </span>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${(project.tasks.filter((t) => t.status === 'done').length / project.tasks.length) * 100}%`,
                        }}
                      />
                    </div>
                    <ol className="task-list">
                      {project.tasks.map((t) => (
                        <li className={t.status} key={t.id}>
                          {t.status === 'done' ? (
                            <CircleCheck size={17} />
                          ) : t.status === 'running' ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : t.status === 'failed' ? (
                            <AlertTriangle size={17} />
                          ) : (
                            <Circle size={17} />
                          )}
                          <div>
                            <b>{t.label}</b>
                            <small>
                              {t.status === 'done'
                                ? '已保存检查点'
                                : t.status === 'running'
                                  ? '执行中'
                                  : t.status === 'failed'
                                    ? '存在缺口'
                                    : '等待执行'}
                              {t.attempts > 1 ? ` · 第${t.attempts}次尝试` : ''}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="card evidence-card">
                    <div className="card-heading">
                      <h3>证据索引</h3>
                      <Badge>{project.evidence.length}</Badge>
                    </div>
                    {project.evidence.length ? (
                      project.evidence.map((e, i) => (
                        <button key={e.id} onClick={() => setEvidence(e)}>
                          <span>E{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <b>{e.label}</b>
                            <small>
                              {e.entity} {e.year || ''}
                            </small>
                          </div>
                          <ChevronRight size={14} />
                        </button>
                      ))
                    ) : (
                      <p className="muted small">取数后，原始字段与计算依赖将出现在这里。</p>
                    )}
                  </div>
                  <div className="trust-note">
                    <ShieldCheck size={17} />
                    <p>
                      证据校验验证引用与算式。
                      <br />
                      研究解释仍需结合边界审阅。
                    </p>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <i className="dot green" />
            持久化研究空间
          </span>
          <span>{boot?.config.database || '数据库连接中'} · X Buddy 2.0</span>
        </footer>
      </div>
      {evidence && project && (
        <EvidenceDrawer
          evidence={evidence}
          p={project}
          onClose={() => setEvidence(undefined)}
          select={selectEvidence}
        />
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-heading">
              <h2 id="settings-title">配置与运行环境</h2>
              <button aria-label="关闭设置" onClick={() => setSettings(false)}>
                <X size={20} />
              </button>
            </div>
            <dl className="environment">
              <dt>持久化数据库</dt>
              <dd>{boot?.config.database}</dd>
              <dt>金融数据</dt>
              <dd>{boot?.config.dataMode === 'live' ? '真实数据网关' : '构造演示样本'}</dd>
              <dt>模型</dt>
              <dd>
                {boot?.config.modelMode === 'live'
                  ? boot.config.modelConfigured
                    ? '已配置真实模型'
                    : '模型待配置，规则降级'
                  : '规则演示（未调用真实模型）'}
              </dd>
              <dt>故障实验</dt>
              <dd>{boot?.config.faultLab ? '已开启' : '未开启'}</dd>
            </dl>
            <div className="info-box">
              服务端配置保存在本地环境文件；密钥不发送到浏览器。MySQL
              部署、模型与金融数据接入步骤见项目 README 和 docs/DATA_ADAPTER.md。
            </div>
            <p className="small muted">
              当前会话按浏览器隔离。清除会话 Cookie 后将进入新的研究空间。
            </p>
            <button className="primary" onClick={() => setSettings(false)}>
              返回研究
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function ResearchIllustration() {
  return (
    <div className="research-illustration" aria-hidden="true">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="illustration-label">A QUESTION BECOMES KNOWLEDGE</div>
      <svg viewBox="0 0 300 140">
        <path
          d="M38 110 C82 110 63 39 112 39 S157 111 190 80 S226 23 270 25"
          fill="none"
          stroke="#c7d6c9"
          strokeWidth="2"
          strokeDasharray="4 5"
        />
        <circle cx="38" cy="110" r="7" fill="#809b87" />
        <circle cx="112" cy="39" r="7" fill="#52745e" />
        <circle cx="190" cy="80" r="7" fill="#809b87" />
        <circle cx="270" cy="25" r="7" fill="#52745e" />
      </svg>
      <div className="illustration-card first">
        <ListChecks size={18} />
        <span>研究计划</span>
        <Check size={13} />
      </div>
      <div className="illustration-card second">
        <Link2 size={18} />
        <span>可验证证据</span>
        <Check size={13} />
      </div>
      <div className="illustration-card third">
        <BookOpen size={18} />
        <span>持续积累的成果</span>
      </div>
    </div>
  );
}
function PlanEditor({
  p,
  boot,
  busy,
  perform,
  update,
  onStart,
}: {
  p: ProjectView;
  boot: Bootstrap;
  busy: boolean;
  perform: (fn: () => Promise<void>) => Promise<void>;
  update: (p: ProjectView) => void;
  onStart: () => void;
}) {
  const [draft, setDraft] = useState<Plan>(p.plan);
  const [budget, setBudget] = useState<Budget>(p.budget);
  const [fault, setFault] = useState<Fault>(p.fault);
  useEffect(() => {
    setDraft(p.plan);
    setBudget(p.budget);
    setFault(p.fault);
  }, [p.plan.version, p.id]);
  const dirty = canonical(draft) !== canonical(p.plan);
  const budgetDirty = canonical(budget) !== canonical(p.budget);
  const editable = p.status !== 'running';
  const pending = p.approvals.find((a) => a.status === 'pending');
  async function save() {
    await perform(async () => {
      let result = p;
      if (dirty) result = await api<ProjectView>(`/projects/${p.id}/plan`, draft, 'PUT');
      if (budgetDirty && result.status === 'draft')
        result = await api<ProjectView>(`/projects/${p.id}/budget`, budget);
      if (fault !== result.fault && result.status === 'draft')
        result = await api<ProjectView>(`/projects/${p.id}/fault`, { fault });
      update(result);
    });
  }
  const toggleMetric = (m: any) =>
    setDraft({
      ...draft,
      metrics: draft.metrics.includes(m)
        ? draft.metrics.filter((x) => x !== m)
        : [...draft.metrics, m],
    });
  return (
    <div className="card plan-editor">
      <div className="card-heading">
        <div>
          <p className="eyebrow">SCOPE BEFORE ACTION</p>
          <h2>先把问题，变成可执行的计划。</h2>
        </div>
        <Badge>版本 {p.plan.version}</Badge>
      </div>
      <div className="plan-rationale">
        <Lightbulb size={18} />
        <p>{p.plan.rationale}</p>
      </div>
      <fieldset disabled={!editable || busy}>
        <legend>研究范围</legend>
        <label>研究对象</label>
        {p.dataMode === 'demo' ? (
          <div className="choice-row">
            {boot.entities.map((e) => (
              <label
                className={`choice ${draft.entities.some((x) => x.code === e.code) ? 'checked' : ''}`}
                key={e.code}
              >
                <input
                  type="checkbox"
                  checked={draft.entities.some((x) => x.code === e.code)}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      entities: draft.entities.some((x) => x.code === e.code)
                        ? draft.entities.filter((x) => x.code !== e.code)
                        : [...draft.entities, e],
                    })
                  }
                />
                {e.name}
              </label>
            ))}
          </div>
        ) : (
          <div className="live-entities">
            {draft.entities.map((e, i) => (
              <div key={i}>
                <input
                  aria-label={`公司${i + 1}名称`}
                  value={e.name}
                  onChange={(ev) =>
                    setDraft({
                      ...draft,
                      entities: draft.entities.map((x, n) =>
                        n === i ? { ...x, name: ev.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`公司${i + 1}代码`}
                  value={e.code}
                  onChange={(ev) =>
                    setDraft({
                      ...draft,
                      entities: draft.entities.map((x, n) =>
                        n === i ? { ...x, code: ev.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}
        <div className="form-row">
          <div>
            <label htmlFor="research-years">年度报告期</label>
            <input
              id="research-years"
              value={draft.years.join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  years: e.target.value
                    .split(/[,，、 ]+/)
                    .filter(Boolean)
                    .map(Number),
                })
              }
            />
            <small>仅使用完整年度数据，避免累计季报混算</small>
          </div>
          <div>
            <label htmlFor="research-asof">研究截止日</label>
            <input
              id="research-asof"
              type="date"
              value={draft.asOf}
              onChange={(e) => setDraft({ ...draft, asOf: e.target.value })}
            />
            <small>截止日之后公开的数据不会进入研究</small>
          </div>
        </div>
        <label>关注指标</label>
        <div className="choice-row">
          {Object.entries(METRIC_LABELS).map(([m, label]) => (
            <label
              className={`choice ${draft.metrics.includes(m as any) ? 'checked' : ''}`}
              key={m}
            >
              <input
                type="checkbox"
                checked={draft.metrics.includes(m as any)}
                onChange={() => toggleMetric(m)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={draft.includeFilings}
            onChange={(e) => setDraft({ ...draft, includeFilings: e.target.checked })}
          />
          <span>检索公开材料，核查反证与可比性</span>
        </label>
      </fieldset>
      <div className="completion">
        <h3>
          <CircleCheck size={16} />
          完成标准
        </h3>
        {draft.completionCriteria.map((c, i) => (
          <label className="criterion-control" key={i}>
            完成标准 {i + 1}
            <select
              aria-label={`完成标准 ${i + 1}`}
              disabled={!editable || busy}
              value={c}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  completionCriteria: draft.completionCriteria.map((x, n) =>
                    n === i ? e.target.value : x,
                  ),
                })
              }
            >
              {!COMPLETION_PRESETS.some((x) => x.label === c) && (
                <option value={c}>待解决：{c}</option>
              )}
              {COMPLETION_PRESETS.map((x) => (
                <option key={x.label}>{x.label}</option>
              ))}
            </select>
            {!COMPLETION_PRESETS.some((x) => x.label === c) && (
              <small>该要求未注册检查器，不能自动宣告完成。</small>
            )}
          </label>
        ))}
        <small>
          批准范围内最多一轮、两项针对现金支撑假设的核查；扩大对象、期间或预算需重新确认。
        </small>
      </div>
      {p.preferences.length > 0 && (
        <div className="info-box">
          <b>本次读取的长期记忆</b>
          {p.preferences.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
      )}
      <details className="advanced">
        <summary>
          <Settings2 size={15} />
          调用预算与故障实验
          <ChevronDown size={15} />
        </summary>
        <div className="budget-inputs">
          {[
            { key: 'maxToolCalls', label: '工具尝试', max: 36 },
            { key: 'maxModelCalls', label: '模型调用', max: 12 },
            { key: 'maxSeconds', label: '总耗时（秒）', max: 900 },
          ].map((x) => (
            <div key={x.key}>
              <label htmlFor={`budget-${x.key}`}>{x.label}</label>
              <input
                id={`budget-${x.key}`}
                type="number"
                min="1"
                max={x.max}
                disabled={p.status !== 'draft' || busy}
                value={budget[x.key as keyof Budget]}
                onChange={(e) => setBudget({ ...budget, [x.key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        {boot.config.faultLab && (
          <div className="fault-field">
            <label htmlFor="fault-select">
              <FlaskConical size={16} />
              故障实验（明确标注，不冒充真实失败）
            </label>
            <select
              id="fault-select"
              disabled={p.status !== 'draft' || busy}
              value={fault}
              onChange={(e) => setFault(e.target.value as Fault)}
            >
              {Object.entries(faultLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </details>
      {(dirty || budgetDirty || fault !== p.fault) && (
        <button className="secondary full-width" disabled={busy} onClick={() => void save()}>
          <Check size={16} />
          保存修改并更新计划
        </button>
      )}
      {pending && (
        <div className="approval-card">
          <div>
            <ShieldCheck size={21} />
            <span>
              <b>{pending.type === 'expand' ? '确认预算扩展' : '确认后开始只读研究'}</b>
              <small>{pending.message}</small>
            </span>
          </div>
          <p>
            最多 {pending.budget.maxToolCalls} 次工具尝试 · {pending.budget.maxModelCalls}{' '}
            次模型调用 · {pending.budget.maxSeconds} 秒运行
          </p>
          <button
            className="primary full-width"
            disabled={busy || dirty || budgetDirty || fault !== p.fault}
            onClick={() =>
              void perform(async () => {
                update(
                  await api<ProjectView>(`/projects/${p.id}/approve`, { approvalId: pending.id }),
                );
                onStart();
              })
            }
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
            确认计划，开始研究
          </button>
          <small>范围或预算改变后，审批需要重新确认。</small>
        </div>
      )}
      {!pending && p.status !== 'running' && (
        <p className="small muted">修改范围将生成新计划版本，并重新建立研究成果。</p>
      )}
    </div>
  );
}
function ReportView({
  p,
  selectEvidence,
}: {
  p: ProjectView;
  selectEvidence: (id: string) => void;
}) {
  const r = p.report!;
  const latest = p.plan.years.at(-1);
  const ratios = p.evidence.filter(
    (e) => e.field === 'cashConversion' && e.year === latest && e.value != null,
  );
  const max = Math.max(...ratios.map((e) => e.value || 0), 1);
  return (
    <div className="report-view">
      <section className="card report-summary">
        <div className="card-heading">
          <span className="summary-icon">
            <BookOpen size={21} />
          </span>
          <Badge
            tone={
              r.modelMode === 'live' ? 'green' : r.modelMode === 'fallback' ? 'amber' : 'neutral'
            }
          >
            {r.modelMode === 'live'
              ? '模型解释 · 需审阅'
              : r.modelMode === 'fallback'
                ? '模型已降级'
                : '规则生成 · 演示'}
          </Badge>
        </div>
        <h2>研究已有进展，判断保留边界。</h2>
        <p>{r.summary}</p>
        <footer>
          <span>
            <Link2 size={14} />
            {r.validation.referencesValid === 'pass' ? '引用已检查' : '引用仍需检查'}
          </span>
          <span>
            <Calculator size={14} />
            {r.validation.calculationChecked === 'pass' ? '算式已复核' : '算式待检查／不适用'}
          </span>
          <span>
            <ShieldCheck size={14} />
            区分事实与判断
          </span>
        </footer>
      </section>
      <ValidationPanel p={p} />
      <CompletionPanel p={p} />
      <section className="card metrics-section">
        <div className="card-heading">
          <h2>把变化放在同一口径下。</h2>
          <Badge>{latest} 年度 · 人民币亿元</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">最近报告期财务指标比较，点击数值查看原始证据</caption>
            <thead>
              <tr>
                <th scope="col">研究指标</th>
                {p.plan.entities.map((e) => (
                  <th scope="col" key={e.code}>
                    {e.name}
                    <small>{e.code}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.plan.metrics.map((metric) => (
                <tr key={metric}>
                  <th scope="row">
                    {METRIC_LABELS[metric]}
                    {metric === 'cashConversion' && <small>经营现金流 ÷ 归母净利润</small>}
                  </th>
                  {p.plan.entities.map((entity) => {
                    const e = p.evidence.find(
                      (e) => e.entity === entity.name && e.year === latest && e.field === metric,
                    );
                    const growth = p.evidence.find(
                      (e) =>
                        e.entity === entity.name &&
                        e.year === latest &&
                        e.field === `${metric}Growth`,
                    );
                    return (
                      <td key={entity.code}>
                        {e ? (
                          <button className="metric-value" onClick={() => selectEvidence(e.id)}>
                            {amount(e)}
                            <ArrowUpRight size={13} />
                          </button>
                        ) : (
                          <span>—</span>
                        )}
                        {growth?.value != null && (
                          <button
                            className={`growth ${growth.value >= 0 ? 'positive' : 'negative'}`}
                            onClick={() => selectEvidence(growth.id)}
                          >
                            {growth.value >= 0 ? '+' : ''}
                            {amount(growth)}
                            <small>较前期</small>
                          </button>
                        )}
                        {e?.value == null && <small className="missing">字段缺失或不适用</small>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.plan.metrics.includes('cashConversion') && ratios.length > 0 && (
          <div className="ratio-chart">
            <div>
              <h3>现金利润比</h3>
              <small>同一年度 · 倍数 · 辅助观察，不作为公司排名</small>
            </div>
            {ratios.map((e) => (
              <button className="ratio-row" key={e.id} onClick={() => selectEvidence(e.id)}>
                <span>{e.entity}</span>
                <div className="bar-track">
                  <div style={{ width: `${Math.max(0, ((e.value || 0) / max) * 100)}%` }} />
                </div>
                <b>{amount(e)}</b>
              </button>
            ))}
            <div className="chart-axis">
              <span>0</span>
              <span>{max.toFixed(2)} 倍</span>
            </div>
          </div>
        )}
      </section>
      <section className="card claims-section">
        <div className="card-heading">
          <h2>判断与它的依据。</h2>
          <span className="small muted">点击引用，检查原始证据</span>
        </div>
        {r.claims.map((c) => (
          <article className={`claim ${c.kind}`} key={c.id}>
            <div className="claim-heading">
              <Badge
                tone={c.kind === 'fact' ? 'green' : c.kind === 'hypothesis' ? 'amber' : 'neutral'}
              >
                {{ fact: '事实', inference: '归纳', hypothesis: '待核查假设' }[c.kind]}
              </Badge>
              <small>
                {c.kind === 'fact' ? '字段／算式校验' : '引用有效 · 解释待审阅，不代表因果已证明'}
              </small>
            </div>
            <p>{c.text}</p>
            <div className="evidence-links">
              {c.supportIds.map((id) => (
                <button key={id} onClick={() => selectEvidence(id)}>
                  <Link2 size={12} />E
                  {String(p.evidence.findIndex((e) => e.id === id) + 1).padStart(2, '0')}
                </button>
              ))}
              {c.counterIds.map((id) => (
                <button className="counter-link" key={id} onClick={() => selectEvidence(id)}>
                  <Quote size={12} />
                  反向或限制材料
                </button>
              ))}
            </div>
            {c.limitations.length > 0 && (
              <small className="claim-limit">{c.limitations.join('；')}</small>
            )}
          </article>
        ))}
      </section>
      <div className="report-two-columns">
        <CounterPanel p={p} selectEvidence={selectEvidence} />
        <section className="card next-card">
          <div className="card-heading">
            <h3>
              <Search size={17} />
              值得继续核查
            </h3>
          </div>
          {r.nextQuestions.map((q) => (
            <p key={q}>
              <ArrowUpRight size={15} />
              {q}
            </p>
          ))}
        </section>
      </div>
      <RevisionsPanel p={p} />
      {r.gaps.length > 0 && (
        <section className="gap-card">
          <h3>
            <AlertTriangle size={18} />
            数据缺口：这些部分尚不能判断
          </h3>
          {r.gaps.map((g) => (
            <p key={g}>{g}</p>
          ))}
        </section>
      )}
    </div>
  );
}
function Followup({
  p,
  busy,
  perform,
  update,
  selectEvidence,
}: {
  p: ProjectView;
  busy: boolean;
  perform: (f: () => Promise<void>) => Promise<void>;
  update: (p: ProjectView) => void;
  selectEvidence: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const pendingRequest = useRef<{ text: string; id: string } | undefined>(undefined);
  const messages = p.messages.slice(2).slice(-8);
  return (
    <section className="card followup">
      <div className="card-heading">
        <h2>
          <Sparkles size={19} />
          让研究继续深入。
        </h2>
        <Badge>沿用当前证据</Badge>
      </div>
      {messages.length > 0 && (
        <div className="messages">
          {messages.map((m) => (
            <div className={`message ${m.role}`} key={m.id}>
              <span className="message-avatar">
                {m.role === 'user' ? '你' : <Sparkles size={14} />}
              </span>
              <div>
                <p>{m.text}</p>
                {m.role === 'assistant' && (
                  <>
                    <small>
                      {m.modelMode === 'live'
                        ? '模型回答'
                        : m.modelMode === 'fallback'
                          ? '模型降级 · 证据检索回答'
                          : '规则演示 · 证据检索回答'}
                    </small>
                    <div className="evidence-links">
                      {m.evidenceIds.map((id) => (
                        <button key={id} onClick={() => selectEvidence(id)}>
                          <Link2 size={12} />
                          {p.evidence.some((e) => e.id === id)
                            ? `E${p.evidence.findIndex((e) => e.id === id) + 1}`
                            : '历史引用'}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="followup-suggestions">
        <button onClick={() => setText('为什么较高现金利润比仍不足以证明经营质量更好？')}>
          检查替代解释 <ArrowUpRight size={12} />
        </button>
        <button onClick={() => setText('当前哪些证据支持判断，哪些问题仍然没有解决？')}>
          核查证据缺口 <ArrowUpRight size={12} />
        </button>
      </div>
      <form
        className="followup-input"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            if (pendingRequest.current?.text !== text)
              pendingRequest.current = { text, id: crypto.randomUUID() };
            update(
              await api<ProjectView>(`/projects/${p.id}/chat`, {
                text,
                requestId: pendingRequest.current.id,
              }),
            );
            pendingRequest.current = undefined;
            setText('');
          });
        }}
      >
        <input
          aria-label="继续研究的问题"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="提出质疑，或继续核查一个问题…"
          maxLength={1500}
        />
        <button
          className="send-button"
          aria-label="发送追问"
          disabled={busy || text.trim().length < 2 || p.status === 'running'}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={18} />}
        </button>
      </form>
    </section>
  );
}
function RunLog({
  p,
  action,
  busy,
}: {
  p: ProjectView;
  action: (a: string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="run-log">
      <div className="usage-grid">
        {[
          {
            icon: Terminal,
            label: '数据调用（含模拟）',
            value: `${p.usage.toolCalls} / ${p.budget.maxToolCalls}`,
          },
          {
            icon: Brain,
            label: '模型调用',
            value: `${p.usage.modelCalls} / ${p.budget.maxModelCalls}`,
          },
          { icon: Clock3, label: '累计运行', value: `${(p.usage.elapsedMs / 1000).toFixed(1)}s` },
          {
            icon: Coins,
            label: '可核算成本',
            value: p.usage.costUsd === null ? '暂不可得' : `$${p.usage.costUsd.toFixed(4)}`,
          },
        ].map((x) => (
          <div className="card usage-card" key={x.label}>
            <x.icon size={18} />
            <small>{x.label}</small>
            <b>{x.value}</b>
          </div>
        ))}
      </div>
      <div className="info-box">
        {p.usage.modelCalls === 0
          ? '当前没有真实模型调用，规划与成果使用标注的规则模式。'
          : `Token：输入 ${p.usage.inputTokens} / 输出 ${p.usage.outputTokens}；未知用量调用 ${p.usage.unknownUsageCalls} 次。成本只统计可取得 usage 且配置价格的调用。`}
        工具失败和重试均计入尝试预算。
      </div>
      <div className="card log-controls">
        <div>
          <b>上下文与恢复</b>
          <small>
            {p.checkpoints.length} 个检查点 ·{' '}
            {p.context ? `摘要 V${p.context.version}` : '尚未压缩'}
          </small>
        </div>
        <button className="secondary" disabled={busy} onClick={() => void action('compact')}>
          <Layers size={15} />
          压缩上下文
        </button>
        {p.status !== 'running' && p.status !== 'draft' && (
          <button className="secondary" disabled={busy} onClick={() => void action('expand')}>
            <Plus size={15} />
            申请预算扩展
          </button>
        )}
      </div>
      <CallsPanel p={p} />
      {p.approvals.some((a) => a.status === 'pending' && a.type === 'expand') && (
        <div className="info-box">
          预算扩展等待确认。请到“研究计划”检查并批准，或
          <button className="text-button" onClick={() => void action('reject')}>
            拒绝扩展
          </button>
          。
        </div>
      )}
      {p.context && (
        <details className="card context-details">
          <summary>
            查看上下文摘要{' '}
            <span>
              {p.context.beforeChars.toLocaleString()} → {p.context.afterChars.toLocaleString()}{' '}
              字符（原记录与摘要大小；实际请求用量见调用账本）
            </span>
          </summary>
          <pre>{JSON.stringify(p.context, null, 2)}</pre>
        </details>
      )}
      {(p.history?.length || 0) > 0 && (
        <details className="card context-details">
          <summary>
            历史计划与证据快照 <span>{p.history!.length} 个历史版本；新范围不复用旧证据</span>
          </summary>
          {p.history!.map((h) => (
            <details key={h.plan.version}>
              <summary>
                版本 {h.plan.version} · {h.plan.entities.map((e) => e.name).join(' × ')} ·{' '}
                {h.evidence.length} 条证据
              </summary>
              <pre>{JSON.stringify(h, null, 2)}</pre>
            </details>
          ))}
        </details>
      )}
      <div className="card timeline">
        <div className="card-heading">
          <h2>执行事件</h2>
          <Badge>实时持久化</Badge>
        </div>
        {[...p.events].reverse().map((e) => (
          <div
            className={`timeline-event ${/failed|exceeded|blocked/.test(e.type) ? 'warning' : ''}`}
            key={e.id}
          >
            <span className="timeline-dot" />
            <div>
              <div>
                <b>{e.message}</b>
                <time>{time(e.at)}</time>
              </div>
              <small>
                {e.type} · #{e.id}
              </small>
              {e.detail !== undefined && (
                <details>
                  <summary>查看事件详情</summary>
                  <pre>{JSON.stringify(e.detail, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
      {p.status === 'running' && (
        <button className="danger-link" disabled={busy} onClick={() => void action('cancel')}>
          <Square size={13} />
          取消研究并保留阶段结果
        </button>
      )}
    </div>
  );
}
function EvidenceDrawer({
  evidence: e,
  p,
  onClose,
  select,
}: {
  evidence: Evidence;
  p: ProjectView;
  onClose: () => void;
  select: (id: string) => void;
}) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-top">
          <span>
            <Link2 size={17} />
            证据详情
          </span>
          <button aria-label="关闭证据详情" onClick={onClose}>
            <PanelRightClose size={21} />
          </button>
        </div>
        <div className="drawer-content">
          <p className="eyebrow">
            {p.evidence.some((x) => x.id === e.id)
              ? `E${String(p.evidence.findIndex((x) => x.id === e.id) + 1).padStart(2, '0')}`
              : '历史引用'}{' '}
            /{' '}
            {e.type === 'field'
              ? 'ORIGINAL FIELD'
              : e.type === 'calculation'
                ? 'VERIFIABLE CALCULATION'
                : 'SOURCE EXCERPT'}
          </p>
          <h2 id="evidence-title">{e.label}</h2>
          <p className="muted">
            {e.entity} {e.year ? `· ${e.year}年度` : ''}
          </p>
          <Badge tone={e.mode === 'demo' ? 'amber' : 'green'}>
            {e.mode === 'demo' ? '构造样本 · 非真实财报' : '真实数据'}
          </Badge>
          {e.type !== 'excerpt' && (
            <div className="evidence-value">
              {amount(e)}
              <small>
                {e.unit === 'CNY yuan'
                  ? '展示单位：人民币亿元；原始单位：元'
                  : e.unit === 'ratio'
                    ? '展示为百分比；原始为小数比率'
                    : e.unit}
              </small>
            </div>
          )}
          <dl className="evidence-meta">
            <dt>数据来源</dt>
            <dd>{e.source}</dd>
            <dt>原始记录</dt>
            <dd>
              <code>{e.sourceRecordId}</code>
            </dd>
            <dt>证据版本</dt>
            <dd>
              计划 V{e.planVersion || '历史'} ·{' '}
              {p.evidence.some((x) => x.id === e.id) ? '当前研究引用' : '历史快照'}
            </dd>
            {e.contentHash && (
              <>
                <dt>内容校验</dt>
                <dd>
                  <code>{e.contentHash}</code>
                </dd>
              </>
            )}
            {e.locator && (
              <>
                <dt>原文位置</dt>
                <dd>{e.locator}</dd>
              </>
            )}
            <dt>公开时间</dt>
            <dd>{e.publishedAt}</dd>
            <dt>采集时间</dt>
            <dd>{e.retrievedAt}</dd>
            <dt>原始单位</dt>
            <dd>{e.unit}</dd>
            {e.field && (
              <>
                <dt>原始字段</dt>
                <dd>
                  <code>{e.field}</code>
                </dd>
              </>
            )}
            {e.sourceUrl && (
              <>
                <dt>来源链接</dt>
                <dd>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                    打开原始来源 <ArrowUpRight size={13} />
                  </a>
                </dd>
              </>
            )}
          </dl>
          {e.formula && (
            <div className="formula-box">
              <b>确定性计算</b>
              <p>{e.formula}</p>
              {e.inputIds.map((id) => (
                <button key={id} onClick={() => select(id)}>
                  <Link2 size={13} />
                  {p.evidence.find((x) => x.id === id)?.label || id}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          )}
          {e.type === 'excerpt' && <blockquote>{String(e.raw)}</blockquote>}
          {e.caveats.length > 0 && (
            <div className="evidence-caveats">
              <h3>
                <AlertTriangle size={15} />
                口径与使用边界
              </h3>
              {e.caveats.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
          )}
          <details className="raw-data" open={e.type === 'field'}>
            <summary>
              查看原始记录 <ChevronDown size={14} />
            </summary>
            <pre>{JSON.stringify(e.raw, null, 2)}</pre>
          </details>
          <div className="trust-note">
            <ShieldCheck size={16} />
            <p>
              原文中的指令不构成执行权限。
              <br />
              证据编号保持可追溯。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
