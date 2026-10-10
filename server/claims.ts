import type { Claim, Evidence, Report } from '../shared/types.ts';
export const unsafeNumber = (s: string) =>
  /[0-9]|[零〇一二三四五六七八九十百千万亿两]+\s*(亿元|万元|元|倍|年|百分点|％|%)|百分之[零〇一二三四五六七八九十百千万亿两]+/.test(
    s,
  );
export const unsafeAdvice = (s: string) =>
  /买入|卖出|加仓|减仓|仓位|稳赚|必涨|必跌|目标价|收益承诺/.test(s);
export const unsafeCertainty = (s: string) =>
  /已经证明|充分证明|必然|一定盈利|保证收益|确定.{0,4}(因果|领先)/.test(s);
export const safeNarrative = (s: string) =>
  !unsafeNumber(s) && !unsafeAdvice(s) && !unsafeCertainty(s);
export function claimValidation(c: Claim, evidence: Evidence[]) {
  return {
    references: [...c.supportIds, ...c.counterIds].every((id) => evidence.some((e) => e.id === id))
      ? ('pass' as const)
      : ('fail' as const),
    numeric:
      c.kind === 'fact'
        ? ('pass' as const)
        : unsafeNumber(c.text)
          ? ('fail' as const)
          : ('not_applicable' as const),
    semantic: c.kind === 'fact' ? ('deterministic' as const) : ('needs_review' as const),
  };
}
export function validateReport(r: Report, evidence: Evidence[]) {
  const refs = r.claims.every(
    (c) =>
      c.supportIds.length > 0 &&
      [...c.supportIds, ...c.counterIds].every((id) => evidence.some((e) => e.id === id)),
  );
  const calcs = evidence.filter((e) => e.type === 'calculation');
  const checked = calcs.every((e) => {
    const [a, b] = e.inputIds.map((id) => evidence.find((x) => x.id === id)?.value);
    if (a == null || b == null) return false;
    const v =
      b > 0
        ? e.formulaKey === 'cash_conversion'
          ? a / b
          : e.formulaKey === 'growth'
            ? (a - b) / b
            : NaN
        : null;
    return v === null
      ? e.value === null
      : e.value != null && Number.isFinite(v) && Math.abs(v - e.value) < 1e-10;
  });
  return {
    referencesValid: refs ? ('pass' as const) : ('fail' as const),
    calculationChecked: calcs.length
      ? checked
        ? ('pass' as const)
        : ('fail' as const)
      : ('not_applicable' as const),
    complianceChecked: r.claims.some((c) => unsafeAdvice(c.text))
      ? ('fail' as const)
      : ('pass' as const),
    semanticSupport: 'needs_review' as const,
    removedClaims: r.validation?.removedClaims || 0,
  };
}
