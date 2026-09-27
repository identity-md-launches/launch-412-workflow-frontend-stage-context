import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { abiHash, handoff, networkInput, out, root, inventory } from './shared.mjs';

if (handoff.version !== 1 || handoff.chainId !== networkInput.network.chainId || Number(BigInt(networkInput.walletAddChain.chainId)) !== handoff.chainId) throw Error('Inconsistent handoff/network');
mkdirSync(resolve(out, 'abi'), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash: expected }) => {
  const bytes = readFileSync(resolve(root, `web/abi/${name}.json`));
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${name}.json`], { cwd: root });
  if (!bytes.equals(pinned)) throw Error(`${name}: ABI differs from pinned implementation export`);
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi) || abiHash(abi) !== expected) throw Error(`${name}: canonical Keccak mismatch`);
  writeFileSync(resolve(out, `abi/${name}.json`), bytes);
  console.log(`Verified ${name} at ${handoff.sourceCommit}: ${expected}`);
  return { name, address, abiHash: expected, abiPath: `abi/${name}.json` };
});
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
writeFileSync(resolve(out, 'imd-deployment.json'), JSON.stringify({ version: 1, launchId, chainId, sourceCommit, attestationHash, contracts, assets: inventory(), network: networkInput.network, walletAddChain: networkInput.walletAddChain }, null, 2) + '\n');
await import('./verify.mjs');
