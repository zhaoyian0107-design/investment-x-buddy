import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPlan, newProject, compact } from '../server/research.ts';
test('语义摘要保留用户纠正、最近回答和已收窄假设，跨版本不混用对话', () => {
  const p = newProject('o', '研究美的集团', demoPlan('研究美的集团', 'demo'), 'demo', 'demo');
  p.messages.push({
    id: 'a',
    role: 'assistant',
    text: '现金支撑的局部观察仍需核查持续性。',
    at: new Date().toISOString(),
    evidenceIds: [],
  });
  p.messages.push({
    id: 'b',
    role: 'user',
    text: '更正：我指的是回款持续性，而不是整体经营质量。',
    at: new Date().toISOString(),
    evidenceIds: [],
  });
  const summary = compact(p);
  assert.ok(summary.userCorrections?.some((c) => c.text.includes('回款持续性')));
  assert.ok(summary.recentMessages?.some((m) => m.id === 'a'));
});
