import { DatabaseSync } from 'node:sqlite';
import { createPool, type Pool } from 'mysql2/promise';
import type {
  Project,
  Memory,
  CallInput,
  CallRecord,
  Evidence,
  SourceSnapshot,
} from '../shared/types.ts';
import { config } from './config.ts';
import { prepareCall, hydrateCalls, authorizeStart } from './calls.ts';
import { evidenceSnapshot, contentHash } from './evidence.ts';
import { migrateProject } from './migrations.ts';
export class ConflictError extends Error {
  constructor() {
    super('项目状态已更新，请刷新后重试');
  }
}
export interface Store {
  get(id: string): Promise<Project | undefined>;
  list(owner?: string): Promise<Project[]>;
  save(p: Project): Promise<void>;
  update(id: string, mutate: (p: Project) => void): Promise<Project>;
  calls(projectId: string): Promise<CallRecord[]>;
  reserveCall(input: CallInput): Promise<CallRecord>;
  startCall(id: string): Promise<void>;
  finishCall(id: string, patch: Partial<CallRecord>): Promise<void>;
  persistEvidence(projectId: string, evidence: Evidence[]): Promise<void>;
  evidence(projectId: string, id?: string): Promise<Evidence[]>;
  snapshots(projectId: string): Promise<SourceSnapshot[]>;
  memories(owner: string): Promise<Memory[]>;
  saveMemory(m: Memory): Promise<void>;
  deleteMemory(id: string, owner: string): Promise<void>;
  lease(worker: string): Promise<boolean>;
  release(worker: string): Promise<void>;
  close(): Promise<void>;
}
export class SqliteStore implements Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner,updated_at);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_lease(id INTEGER PRIMARY KEY, worker TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS call_ledger(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,command_key TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(project_id,command_key));
      CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_snapshots(project_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));
      CREATE TABLE IF NOT EXISTS evidence_records(project_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id));
      INSERT OR IGNORE INTO schema_versions VALUES(2,datetime('now'));`);
    for (const r of this.db.prepare('SELECT payload FROM projects').all()) {
      const p = JSON.parse(r.payload as string) as Project;
      if (p.schemaVersion !== 2) {
        migrateProject(p);
        p.revision++;
        this.db
          .prepare('UPDATE projects SET payload=?,revision=? WHERE id=?')
          .run(JSON.stringify(p), p.revision, p.id);
      }
    }
  }
  async get(id: string) {
    const r = this.db.prepare('SELECT payload FROM projects WHERE id=?').get(id) as
      { payload: string } | undefined;
    return r ? hydrateCalls(JSON.parse(r.payload) as Project, await this.calls(id)) : undefined;
  }
  async list(owner?: string) {
    const rows = owner
      ? this.db
          .prepare('SELECT payload FROM projects WHERE owner=? ORDER BY updated_at DESC')
          .all(owner)
      : this.db.prepare('SELECT payload FROM projects ORDER BY updated_at').all();
    return Promise.all(
      rows.map(async (r) => {
        const p = JSON.parse(r.payload as string) as Project;
        return hydrateCalls(p, await this.calls(p.id));
      }),
    );
  }
  async save(p: Project) {
    const previous = p.revision;
    const updated = { ...p, revision: previous + 1, updatedAt: new Date().toISOString() };
    if (!previous)
      this.db
        .prepare('INSERT INTO projects(id,owner,revision,payload,updated_at) VALUES(?,?,?,?,?)')
        .run(p.id, p.owner, 1, JSON.stringify(updated), updated.updatedAt);
    else {
      const result = this.db
        .prepare('UPDATE projects SET revision=?,payload=?,updated_at=? WHERE id=? AND revision=?')
        .run(updated.revision, JSON.stringify(updated), updated.updatedAt, p.id, previous);
      if (!result.changes) throw new ConflictError();
    }
    Object.assign(p, updated);
  }
  async update(id: string, mutate: (p: Project) => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.db.prepare('SELECT payload FROM projects WHERE id=?').get(id) as
        { payload: string } | undefined;
      if (!r) throw new Error('研究项目不存在');
      const rows = this.db
        .prepare('SELECT payload FROM call_ledger WHERE project_id=? ORDER BY rowid')
        .all(id);
      const p = hydrateCalls(
        JSON.parse(r.payload),
        rows.map((r) => JSON.parse(r.payload as string)),
      );
      mutate(p);
      p.revision++;
      p.updatedAt = new Date().toISOString();
      this.db
        .prepare('UPDATE projects SET payload=?,revision=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(p), p.revision, p.updatedAt, id);
      this.db.exec('COMMIT');
      return p;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async calls(projectId: string) {
    return this.db
      .prepare('SELECT payload FROM call_ledger WHERE project_id=? ORDER BY rowid')
      .all(projectId)
      .map((r) => JSON.parse(r.payload as string) as CallRecord);
  }
  async reserveCall(input: CallInput) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.db.prepare('SELECT payload FROM projects WHERE id=?').get(input.projectId) as
        { payload: string } | undefined;
      if (!r) throw new Error('研究项目不存在');
      const rows = this.db
        .prepare('SELECT payload FROM call_ledger WHERE project_id=?')
        .all(input.projectId)
        .map((r) => JSON.parse(r.payload as string));
      const p = hydrateCalls(JSON.parse(r.payload), rows);
      const c = prepareCall(p, rows, input);
      for (const previous of rows.filter((c) => c.state === 'released'))
        this.db
          .prepare('UPDATE call_ledger SET payload=? WHERE id=?')
          .run(JSON.stringify(previous), previous.id);
      this.db
        .prepare('INSERT INTO call_ledger VALUES(?,?,?,?)')
        .run(c.id, c.projectId, c.key, JSON.stringify(c));
      this.db.exec('COMMIT');
      return c;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async startCall(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.db.prepare('SELECT payload FROM call_ledger WHERE id=?').get(id) as {
        payload: string;
      };
      const c = JSON.parse(r.payload) as CallRecord;
      const row = this.db.prepare('SELECT payload FROM projects WHERE id=?').get(c.projectId) as {
        payload: string;
      };
      const p = JSON.parse(row.payload) as Project;
      authorizeStart(p, c);
      c.state = 'started';
      c.startedAt = new Date().toISOString();
      this.db.prepare('UPDATE call_ledger SET payload=? WHERE id=?').run(JSON.stringify(c), id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async finishCall(id: string, patch: Partial<CallRecord>) {
    const r = this.db.prepare('SELECT payload FROM call_ledger WHERE id=?').get(id) as {
      payload: string;
    };
    const c = { ...JSON.parse(r.payload), ...patch };
    this.db.prepare('UPDATE call_ledger SET payload=? WHERE id=?').run(JSON.stringify(c), id);
  }
  async persistEvidence(projectId: string, evidence: Evidence[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const e of evidence) {
        const old = this.db
          .prepare('SELECT payload FROM evidence_records WHERE project_id=? AND id=?')
          .get(projectId, e.id) as { payload: string } | undefined;
        if (old && contentHash(JSON.parse(old.payload)) !== contentHash(e))
          throw new Error('不可变证据不能被覆盖');
        const s = evidenceSnapshot(projectId, e);
        this.db
          .prepare('INSERT OR IGNORE INTO source_snapshots VALUES(?,?,?)')
          .run(projectId, s.id, JSON.stringify(s));
        this.db
          .prepare('INSERT OR IGNORE INTO evidence_records VALUES(?,?,?)')
          .run(projectId, e.id, JSON.stringify(e));
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async evidence(projectId: string, id?: string) {
    return (
      id
        ? this.db
            .prepare('SELECT payload FROM evidence_records WHERE project_id=? AND id=?')
            .all(projectId, id)
        : this.db.prepare('SELECT payload FROM evidence_records WHERE project_id=?').all(projectId)
    ).map((r) => JSON.parse(r.payload as string) as Evidence);
  }
  async snapshots(projectId: string) {
    return this.db
      .prepare('SELECT payload FROM source_snapshots WHERE project_id=?')
      .all(projectId)
      .map((r) => JSON.parse(r.payload as string) as SourceSnapshot);
  }
  async memories(owner: string) {
    return this.db
      .prepare('SELECT payload FROM memories WHERE owner=?')
      .all(owner)
      .map((r) => JSON.parse(r.payload as string) as Memory);
  }
  async saveMemory(m: Memory) {
    this.db.prepare('INSERT INTO memories VALUES(?,?,?)').run(m.id, m.owner, JSON.stringify(m));
  }
  async deleteMemory(id: string, owner: string) {
    this.db.prepare('DELETE FROM memories WHERE id=? AND owner=?').run(id, owner);
  }
  async lease(worker: string) {
    const now = Date.now();
    const r = this.db
      .prepare(
        'INSERT INTO worker_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET worker=excluded.worker,expires=excluded.expires WHERE worker_lease.expires<? OR worker_lease.worker=?',
      )
      .run(worker, now + config.leaseMs, now, worker);
    return !!r.changes;
  }
  async release(worker: string) {
    this.db.prepare('DELETE FROM worker_lease WHERE worker=?').run(worker);
  }
  async close() {
    this.db.close();
  }
}
export class MysqlStore implements Store {
  pool: Pool;
  // MySQL binary JSON can reserialize a double with a different last digit.
  // Store canonical payload text as a JSON string; indexed identity/revision
  // columns remain relational. mysql2 decodes the outer JSON string for parse().
  exact(value: unknown) {
    return JSON.stringify(JSON.stringify(value));
  }
  constructor(url: string) {
    this.pool = createPool(url);
  }
  async init() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS projects(id VARCHAR(64) PRIMARY KEY, owner VARCHAR(64) NOT NULL, revision INT NOT NULL, payload JSON NOT NULL, updated_at VARCHAR(32) NOT NULL, INDEX projects_owner(owner,updated_at)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS memories(id VARCHAR(64) PRIMARY KEY, owner VARCHAR(64) NOT NULL, payload JSON NOT NULL, INDEX memories_owner(owner)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS worker_lease(id INT PRIMARY KEY, worker VARCHAR(64), expires BIGINT)',
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS call_ledger(id VARCHAR(64) PRIMARY KEY,project_id VARCHAR(64) NOT NULL,command_key VARCHAR(240) NOT NULL,payload JSON NOT NULL,UNIQUE KEY call_command(project_id,command_key))',
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS schema_versions(version INT PRIMARY KEY,applied_at VARCHAR(32) NOT NULL)',
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS source_snapshots(project_id VARCHAR(64) NOT NULL,id VARCHAR(80) NOT NULL,payload JSON NOT NULL,PRIMARY KEY(project_id,id))',
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS evidence_records(project_id VARCHAR(64) NOT NULL,id VARCHAR(80) NOT NULL,payload JSON NOT NULL,PRIMARY KEY(project_id,id))',
    );
    await this.pool.execute('INSERT IGNORE INTO schema_versions VALUES(2,?)', [
      new Date().toISOString(),
    ]);
    const [legacy] = await this.pool.query('SELECT payload FROM projects');
    for (const r of legacy as any[]) {
      const p = this.parse(r);
      if (p.schemaVersion !== 2) {
        migrateProject(p);
        await this.save(p);
      }
    }
  }
  parse(r: any) {
    return (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Project;
  }
  async get(id: string) {
    const [rs] = await this.pool.execute('SELECT payload FROM projects WHERE id=?', [id]);
    const r = (rs as any[])[0];
    return r ? hydrateCalls(this.parse(r), await this.calls(id)) : undefined;
  }
  async list(owner?: string) {
    const [rs] = await this.pool.execute(
      owner
        ? 'SELECT payload FROM projects WHERE owner=? ORDER BY updated_at DESC'
        : 'SELECT payload FROM projects ORDER BY updated_at',
      owner ? [owner] : [],
    );
    return Promise.all(
      (rs as any[]).map(async (r) => {
        const p = this.parse(r);
        return hydrateCalls(p, await this.calls(p.id));
      }),
    );
  }
  async save(p: Project) {
    const prev = p.revision;
    const updated = { ...p, revision: prev + 1, updatedAt: new Date().toISOString() };
    if (!prev)
      await this.pool.execute('INSERT INTO projects VALUES(?,?,?,?,?)', [
        p.id,
        p.owner,
        1,
        this.exact(updated),
        updated.updatedAt,
      ]);
    else {
      const [r] = await this.pool.execute(
        'UPDATE projects SET revision=?,payload=?,updated_at=? WHERE id=? AND revision=?',
        [updated.revision, this.exact(updated), updated.updatedAt, p.id, prev],
      );
      if (!(r as any).affectedRows) throw new ConflictError();
    }
    Object.assign(p, updated);
  }
  async update(id: string, mutate: (p: Project) => void) {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rs] = await conn.execute('SELECT payload FROM projects WHERE id=? FOR UPDATE', [id]);
      if (!(rs as any[])[0]) throw new Error('研究项目不存在');
      const [cs] = await conn.execute('SELECT payload FROM call_ledger WHERE project_id=?', [id]);
      const records = (cs as any[]).map((r) =>
        typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      );
      const p = hydrateCalls(this.parse((rs as any[])[0]), records);
      mutate(p);
      p.revision++;
      p.updatedAt = new Date().toISOString();
      await conn.execute('UPDATE projects SET payload=?,revision=?,updated_at=? WHERE id=?', [
        this.exact(p),
        p.revision,
        p.updatedAt,
        id,
      ]);
      await conn.commit();
      return p;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async calls(projectId: string) {
    const [rs] = await this.pool.execute(
      "SELECT payload FROM call_ledger WHERE project_id=? ORDER BY JSON_UNQUOTE(JSON_EXTRACT(payload,'$.reservedAt'))",
      [projectId],
    );
    return (rs as any[]).map((r) =>
      typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    ) as CallRecord[];
  }
  async reserveCall(input: CallInput) {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rs] = await conn.execute('SELECT payload FROM projects WHERE id=? FOR UPDATE', [
        input.projectId,
      ]);
      if (!(rs as any[])[0]) throw new Error('研究项目不存在');
      const [cs] = await conn.execute('SELECT payload FROM call_ledger WHERE project_id=?', [
        input.projectId,
      ]);
      const records = (cs as any[]).map((r) =>
        typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      );
      const p = hydrateCalls(this.parse((rs as any[])[0]), records);
      const c = prepareCall(p, records, input);
      for (const previous of records.filter((c) => c.state === 'released'))
        await conn.execute('UPDATE call_ledger SET payload=? WHERE id=?', [
          JSON.stringify(previous),
          previous.id,
        ]);
      await conn.execute('INSERT INTO call_ledger VALUES(?,?,?,?)', [
        c.id,
        c.projectId,
        c.key,
        JSON.stringify(c),
      ]);
      await conn.commit();
      return c;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async startCall(id: string) {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    try {
      const [cs] = await conn.execute('SELECT payload FROM call_ledger WHERE id=?', [id]);
      let c = this.parse((cs as any[])[0]) as unknown as CallRecord;
      const [ps] = await conn.execute('SELECT payload FROM projects WHERE id=? FOR UPDATE', [
        c.projectId,
      ]);
      const p = this.parse((ps as any[])[0]);
      const [locked] = await conn.execute('SELECT payload FROM call_ledger WHERE id=? FOR UPDATE', [
        id,
      ]);
      c = this.parse((locked as any[])[0]) as unknown as CallRecord;
      authorizeStart(p, c);
      c.state = 'started';
      c.startedAt = new Date().toISOString();
      await conn.execute('UPDATE call_ledger SET payload=? WHERE id=?', [JSON.stringify(c), id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async finishCall(id: string, patch: Partial<CallRecord>) {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rs] = await conn.execute('SELECT payload FROM call_ledger WHERE id=? FOR UPDATE', [
        id,
      ]);
      const c = { ...this.parse((rs as any[])[0]), ...patch };
      await conn.execute('UPDATE call_ledger SET payload=? WHERE id=?', [JSON.stringify(c), id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async persistEvidence(projectId: string, evidence: Evidence[]) {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    try {
      for (const e of evidence) {
        const [rs] = await conn.execute(
          'SELECT payload FROM evidence_records WHERE project_id=? AND id=? FOR UPDATE',
          [projectId, e.id],
        );
        if ((rs as any[])[0] && contentHash(this.parse((rs as any[])[0])) !== contentHash(e))
          throw new Error('不可变证据不能被覆盖');
        const s = evidenceSnapshot(projectId, e);
        await conn.execute('INSERT IGNORE INTO source_snapshots VALUES(?,?,?)', [
          projectId,
          s.id,
          this.exact(s),
        ]);
        await conn.execute('INSERT IGNORE INTO evidence_records VALUES(?,?,?)', [
          projectId,
          e.id,
          this.exact(e),
        ]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async evidence(projectId: string, id?: string) {
    const [rs] = await this.pool.execute(
      id
        ? 'SELECT payload FROM evidence_records WHERE project_id=? AND id=?'
        : 'SELECT payload FROM evidence_records WHERE project_id=?',
      id ? [projectId, id] : [projectId],
    );
    return (rs as any[]).map((r) => this.parse(r)) as unknown as Evidence[];
  }
  async snapshots(projectId: string) {
    const [rs] = await this.pool.execute(
      'SELECT payload FROM source_snapshots WHERE project_id=?',
      [projectId],
    );
    return (rs as any[]).map((r) => this.parse(r)) as unknown as SourceSnapshot[];
  }
  async memories(owner: string) {
    const [rs] = await this.pool.execute('SELECT payload FROM memories WHERE owner=?', [owner]);
    return (rs as any[]).map(
      (r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Memory,
    );
  }
  async saveMemory(m: Memory) {
    await this.pool.execute('INSERT INTO memories VALUES(?,?,?)', [
      m.id,
      m.owner,
      JSON.stringify(m),
    ]);
  }
  async deleteMemory(id: string, owner: string) {
    await this.pool.execute('DELETE FROM memories WHERE id=? AND owner=?', [id, owner]);
  }
  async lease(worker: string) {
    const now = Date.now();
    await this.pool.execute('INSERT IGNORE INTO worker_lease VALUES(1,?,?)', [
      worker,
      now + config.leaseMs,
    ]);
    await this.pool.execute(
      'UPDATE worker_lease SET worker=?,expires=? WHERE id=1 AND (expires<? OR worker=?)',
      [worker, now + config.leaseMs, now, worker],
    );
    const [rs] = await this.pool.query('SELECT worker FROM worker_lease WHERE id=1');
    return (rs as any[])[0]?.worker === worker;
  }
  async release(worker: string) {
    await this.pool.execute('DELETE FROM worker_lease WHERE worker=?', [worker]);
  }
  async close() {
    await this.pool.end();
  }
}
export async function createStore(): Promise<Store> {
  let store: Store;
  if (config.databaseUrl) {
    if (!config.databaseUrl.startsWith('mysql://'))
      throw new Error('DATABASE_URL 必须使用 mysql://');
    const s = new MysqlStore(config.databaseUrl);
    await s.init();
    store = s;
  } else {
    store = new SqliteStore(config.sqlitePath);
  }
  // Started requests remain charged. A recent reservation may belong to another
  // request; only release it after its dispatch window expires. startCall checks
  // the reservation again, so a released request can never dispatch later.
  for (const p of await store.list()) {
    for (const c of await store.calls(p.id))
      if (
        c.state === 'started' ||
        (c.state === 'reserved' && Date.now() - Date.parse(c.reservedAt) > 60000)
      )
        await store.finishCall(c.id, {
          state: c.state === 'started' ? 'unknown' : 'released',
          endedAt: new Date().toISOString(),
          error: '恢复未确认请求；已发起调用仍计入预算，未发起预占过期后释放',
        });
    const evidence = [
      ...p.evidence,
      ...(p.archivedEvidence || []),
      ...(p.history || []).flatMap((h) => h.evidence),
    ];
    await store.persistEvidence(p.id, [...new Map(evidence.map((e) => [e.id, e])).values()]);
  }
  return store;
}
