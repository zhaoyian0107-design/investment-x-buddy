import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const sqlitePath = resolve(process.env.SQLITE_PATH || './data/buddy.sqlite');
mkdirSync(dirname(sqlitePath), { recursive: true });
const secretFile = resolve(dirname(sqlitePath), '.session-secret');
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.DATABASE_URL) throw new Error('MySQL 部署必须配置稳定的 SESSION_SECRET');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const value = randomBytes(32).toString('hex');
  writeFileSync(secretFile, value, { mode: 0o600 });
  return value;
}
export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || '',
  sqlitePath,
  sessionSecret: sessionSecret(),
  accessToken: process.env.APP_ACCESS_TOKEN || '',
  secureCookie: process.env.COOKIE_SECURE === 'true',
  dataMode: (process.env.DATA_MODE === 'live' ? 'live' : 'demo') as 'live' | 'demo',
  modelMode: (process.env.MODEL_MODE === 'live' ? 'live' : 'demo') as 'live' | 'demo',
  modelBase: (process.env.MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  modelStyle: process.env.MODEL_API_STYLE || 'responses',
  model: process.env.MODEL_NAME || '',
  modelKey: process.env.MODEL_API_KEY || '',
  inputRate: process.env.MODEL_INPUT_USD_PER_MILLION,
  outputRate: process.env.MODEL_OUTPUT_USD_PER_MILLION,
  gateway: (process.env.DATA_GATEWAY_URL || '').replace(/\/$/, ''),
  gatewayToken: process.env.DATA_GATEWAY_TOKEN || '',
  dataProvider: process.env.DATA_PROVIDER || (process.env.DATA_GATEWAY_URL ? 'gateway' : 'fuyao'),
  fuyaoKey: process.env.FUYAO_API_KEY || '',
  allowedSourceHosts: (process.env.DATA_ALLOWED_SOURCE_HOSTS || '').split(',').filter(Boolean),
  faultLab: process.env.ENABLE_FAULT_LAB !== 'false',
  delayMs: Number(process.env.TASK_DELAY_MS || 650),
  leaseMs: Math.max(1000, Number(process.env.WORKER_LEASE_MS || 15000)),
};
