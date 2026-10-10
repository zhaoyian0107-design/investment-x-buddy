import type { Project } from '../shared/types.ts';
type P = Omit<Project, 'owner'>;
const status = (v: unknown) =>
  v === 'pass' || v === true
    ? '已检查'
    : v === 'fail' || v === false
      ? '检查未通过'
      : v === 'not_applicable'
        ? '不适用'
        : '待核查';
export function CompletionPanel({ p }: { p: P }) {
  return (
    <section className="card audit-panel">
      <div className="card-heading">
        <h2>研究目标达成情况</h2>
        <span className={`audit-tag ${p.completion?.outcome === 'met' ? 'good' : 'pending'}`}>
          {p.completion?.outcome === 'met' ? '已达到约定标准' : '仍有待解决问题'}
        </span>
      </div>
      <p className="muted">
        {p.completion?.executionFinished ? '当前任务已执行结束。' : '执行进度与研究结论分别检查。'}{' '}
        达成标准不代表投资判断客观正确。
      </p>
      {(p.completion?.criteria || p.plan.criteria || []).map((c) => (
        <div className="criterion-row" key={c.id}>
          <span className={`audit-tag ${'status' in c && c.status === 'met' ? 'good' : 'pending'}`}>
            {'status' in c && c.status === 'met' ? '已达成' : '未达成'}
          </span>
          <div>
            <b>{c.label}</b>
            <small>
              {'reason' in c
                ? String(c.reason)
                : c.kind === 'unsupported'
                  ? '当前能力无法检查，请调整计划'
                  : '执行后逐项核验'}
            </small>
          </div>
        </div>
      ))}
    </section>
  );
}
export function ValidationPanel({ p }: { p: P }) {
  const v = p.report?.validation;
  return (
    <div className="info-box validation-strip">
      <span>引用：{status(v?.referencesValid)}</span>
      <span>算式：{status(v?.calculationChecked)}</span>
      <span>输出边界：{status(v?.complianceChecked)}</span>
      <span>金融解释：仍需审阅</span>
    </div>
  );
}
export function CounterPanel({
  p,
  selectEvidence,
}: {
  p: P;
  selectEvidence: (id: string) => void;
}) {
  return (
    <section className="card counter-card audit-panel">
      <div className="card-heading">
        <h3>反证与适用范围核查</h3>
        <span className="audit-tag">{p.counterChecks?.length || 0} 项核查</span>
      </div>
      {!p.counterChecks?.length && (
        <p>
          {p.plan.includeFilings
            ? '尚未形成针对判断的核查记录。'
            : '本计划未授权原文核查，持续性与因果解释保持未核实。'}
        </p>
      )}
      {p.counterChecks?.map((c) => (
        <details className="counter-check" key={c.id} open>
          <summary>
            {c.question}
            <span className={`audit-tag ${c.status === 'checked' ? 'good' : 'pending'}`}>
              {c.status === 'checked' ? '材料已检查' : '未完成'}
            </span>
          </summary>
          <p className="muted">
            {c.entity} · 截止 {c.coverage.asOf} · 取回{' '}
            {c.coverage.recordsRetrieved ?? c.coverage.recordsReviewed} 份 · 审阅{' '}
            {c.coverage.recordsReviewed} 份材料
          </p>
          <small>可改变判断的条件：{c.condition}</small>
          {c.findings.map((f) => (
            <div className={`finding ${f.relation}`} key={f.evidenceId}>
              <span className="audit-tag">
                {
                  {
                    supports: '支持',
                    contradicts: '反向材料',
                    limits: '适用范围限制',
                    irrelevant: '无关材料',
                  }[f.relation]
                }
              </span>
              <blockquote>{f.quote}</blockquote>
              <small>
                {f.reason} ·{' '}
                {f.assessment === 'rule_demo' ? '构造材料规则演示' : '模型关系评估，需审阅'}
              </small>
              <button className="text-button" onClick={() => selectEvidence(f.evidenceId)}>
                打开引用原文
              </button>
            </div>
          ))}
          {c.limitations.map((s) => (
            <small key={s}>{s}</small>
          ))}
        </details>
      ))}
      <small>未发现反证不等于不存在反证；覆盖范围与关系评估均可检查。</small>
    </section>
  );
}
export function RevisionsPanel({ p }: { p: P }) {
  if (!p.claimRevisions?.length) return null;
  return (
    <section className="card audit-panel">
      <h2>材料如何改变判断</h2>
      {p.claimRevisions.map((r, i) => (
        <div className="revision-row" key={`${r.claimId}-${i}`}>
          <small>修订前 · {r.before.kind === 'hypothesis' ? '待核查假设' : '归纳'}</small>
          <p>{r.before.text}</p>
          <small>修订后 · 保留不确定性</small>
          <p className="revised-text">{r.after.text}</p>
          <small>
            依据 {r.checkIds.length} 项核查 · {r.at}
          </small>
        </div>
      ))}
    </section>
  );
}
export function CallsPanel({ p }: { p: P }) {
  return (
    <details className="card context-details">
      <summary>
        调用账本{' '}
        <span>
          已预占 {p.calls?.filter((c) => c.state === 'reserved').length || 0} · 结果未知{' '}
          {p.calls?.filter((c) => c.state === 'unknown' || c.state === 'started').length || 0}
        </span>
      </summary>
      {p.legacyUsage && (
        <p className="info-box">
          原版保留用量：模型 {p.legacyUsage.modelCalls} 次，工具 {p.legacyUsage.toolCalls}{' '}
          次。旧用量没有独立请求记录，单列保留，不视作新版账本的已核算费用。
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>用途</th>
              <th>模式</th>
              <th>结果</th>
              <th>输入字符 / Token</th>
              <th>可核算成本</th>
            </tr>
          </thead>
          <tbody>
            {p.calls?.map((c) => (
              <tr key={c.id}>
                <td>{c.purpose}</td>
                <td>{c.mode === 'demo' && c.kind === 'tool' ? '构造模拟' : '实际模型／接口'}</td>
                <td>
                  {
                    {
                      reserved: '已预占',
                      started: '请求已发起',
                      succeeded: '调用成功',
                      failed: '响应未通过检查',
                      unknown: '结果或用量未知',
                      released: '未发出，已释放',
                    }[c.state]
                  }
                </td>
                <td>
                  {c.inputChars ?? '—'} / {c.usageKnown ? c.inputTokens : '未知'}
                </td>
                <td>{c.costUsd == null ? '未知／不适用' : `$${c.costUsd.toFixed(6)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>已发起请求按尝试计入预算。成功调用仍可能产生未通过验证的内容。</small>
    </details>
  );
}
