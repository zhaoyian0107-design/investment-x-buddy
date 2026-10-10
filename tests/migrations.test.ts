import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteStore } from '../server/store.ts';
import { demoPlan, newProject, baseReport } from '../server/research.ts';
import { requireGrant } from '../server/policy.ts';
test('旧数据升级保留历史，撤销旧授权且不把旧验证标记冒充重新验证', async () => {
  mkdirSync('work', { recursive: true });
  const dir = mkdtempSync(resolve('work/migration-'));
  const path = resolve(dir, 'legacy.sqlite');
  let s = new SqliteStore(path);
  const p = newProject(
    'old-owner',
    '研究美的集团',
    demoPlan('研究美的集团', 'demo'),
    'demo',
    'demo',
  );
  delete p.schemaVersion;
  delete p.ledgerBaseUsage;
  p.status = 'running';
  p.approvals[0].status = 'approved';
  p.usage.modelCalls = 9;
  p.report = baseReport(p, 'demo');
  p.report.validation.referencesValid = true;
  await s.save(p);
  await s.close();
  s = new SqliteStore(path);
  try {
    const migrated = (await s.get(p.id))!;
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.legacy, true);
    assert.equal(migrated.legacyUsage!.modelCalls, 9);
    assert.equal(migrated.usage.modelCalls, 0);
    assert.equal(migrated.status, 'paused');
    assert.equal(migrated.report!.validation.referencesValid, 'not_checked');
    assert.throws(() => requireGrant(migrated));
    assert.equal(migrated.goal, p.goal);
  } finally {
    await s.close();
  }
});
