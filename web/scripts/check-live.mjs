import { createPublicClient, http } from 'viem';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readJSON, root, out } from './shared.mjs';

const manifest = readJSON(resolve(out, 'imd-deployment.json'));
const lottery = manifest.contracts.find(c => c.name === 'BlockhashLottery');
const abi = readJSON(resolve(out, lottery.abiPath));
const results = await Promise.all(manifest.network.rpcUrls.map(async endpoint => {
  const client = createPublicClient({ transport: http(endpoint, { timeout: 12000, retryCount: 0 }) });
  try {
    const chainId = await client.getChainId();
    if (chainId !== manifest.chainId) throw Error('Wrong chain');
    const contracts = await Promise.all(manifest.contracts.map(async contract => {
      const code = await client.getCode({ address: contract.address });
      if (!code || code === '0x') throw Error(`${contract.name}: missing code`);
      return { name: contract.name, address: contract.address, codeBytes: (code.length - 2) / 2 };
    }));
    const block = await client.getBlockNumber();
    const read = functionName => client.readContract({ address: lottery.address, abi, functionName, blockNumber: block });
    const [token, round, genesis] = await Promise.all(['token', 'currentRound', 'deploymentBlock'].map(read));
    if (token.toLowerCase() !== manifest.contracts.find(c => c.name === 'LaunchToken').address.toLowerCase()) throw Error('Wrong token pointer');
    return { endpoint, status: 'passed', chainId, block: String(block), token, round: String(round), deploymentBlock: String(genesis), contracts };
  } catch (error) { return { endpoint, status: 'unavailable', error: error.shortMessage ?? error.message }; }
}));
const report = { date: new Date().toISOString(), mode: 'Read-only public RPC checks; no wallet, signing or broadcasts', results };
writeFileSync(resolve(root, 'docs/evidence/live-rpc.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!results.some(result => result.status === 'passed')) process.exitCode = 1;
