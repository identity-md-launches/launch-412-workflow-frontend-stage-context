import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { keccak256, toBytes } from 'viem';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const out = resolve(root, 'dist');
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export const handoff = readJSON(resolve(root, 'web/config/handoff.json'));
export const networkInput = readJSON(resolve(root, 'web/config/network.json'));
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const abiHash = abi => keccak256(toBytes(canonical(abi))).slice(2);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function files(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
export const inventory = () => files(out).filter(path => relative(out, path) !== 'imd-deployment.json').map(path => ({ path: relative(out, path).replaceAll('\\', '/'), sha256: sha256(readFileSync(path)) }));
