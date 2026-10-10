import type { Project } from '../shared/types.ts';
export function semanticContext(p: Project) {
  const messages = p.messages.filter((m) => (m.planVersion || 1) === p.plan.version);
  return {
    planVersion: p.plan.version,
    recentMessages: messages.slice(-6).map((m) => ({ ...m, text: m.text.slice(0, 2500) })),
    userCorrections: messages
      .filter((m) => m.role === 'user' && /更正|纠正|我指的是|不是|不要理解/.test(m.text))
      .slice(-8)
      .map((m) => ({
        messageId: m.id,
        text: m.text,
        source: 'user' as const,
        status: 'unverified' as const,
      })),
    confirmedFacts: (p.report?.claims || [])
      .filter((c) => c.kind === 'fact' && c.verified)
      .slice(-18)
      .map((c) => ({ text: c.text, evidenceIds: c.supportIds })),
    currentJudgments: (p.report?.claims || [])
      .filter((c) => c.kind !== 'fact')
      .slice(-6)
      .map((c) => ({
        id: c.id,
        text: c.text,
        kind: c.kind,
        evidenceIds: [...c.supportIds, ...c.counterIds],
        validation: c.validation,
      })),
    revisedHypotheses: (p.claimRevisions || []).slice(-6).map((r) => ({
      claimId: r.claimId,
      before: r.before.text,
      after: r.after.text,
      checkIds: r.checkIds,
    })),
  };
}
