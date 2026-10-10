import { readFileSync } from 'node:fs';
import { verifyBundle } from '../shared/bundle.ts';
const path = process.argv[2];
if (!path) throw new Error('用法：node scripts/verify-bundle.mjs research-bundle.json');
const result = verifyBundle(JSON.parse(readFileSync(path, 'utf8')));
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
