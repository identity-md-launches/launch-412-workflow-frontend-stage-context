import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, encodeErrorResult, toHex, zeroAddress } from 'viem';
import { handoff, networkInput, root } from '../scripts/shared.mjs';

export const account = '0x1111111111111111111111111111111111111111';
export const other = '0x2222222222222222222222222222222222222222';
export const token = handoff.contracts.find(c => c.name === 'LaunchToken');
export const lottery = handoff.contracts.find(c => c.name === 'BlockhashLottery');
export const tokenAbi = JSON.parse(readFileSync(`${root}/web/abi/LaunchToken.json`));
export const lotteryAbi = JSON.parse(readFileSync(`${root}/web/abi/BlockhashLottery.json`));
const unit = 10n ** 18n;
const price = 1000n * unit;
const blockHash = `0x${'bc'.repeat(32)}`;
export function fixture() {
  const genesis = BigInt(lottery.blockNumber);
  return {
    genesis, block: genesis + 930n, chainId: handoff.chainId, walletChain: handoff.chainId,
    accounts: [account], allowance: 0n, balance: 500000n * unit, credit: 95000n * unit,
    tickets: 2n, selectedState: 0, refundDone: false, missingCode: false, tokenMismatch: false,
    rpcFail: false, simulationFail: false, reject: false, receiptFail: false,
    unknownChain: false, calls: [], transactions: [], receipts: new Map(), rollover: false,
  };
}
export function eventLog(name, args, block, hash = `0x${'ab'.repeat(32)}`, index = 0) {
  const event = lotteryAbi.find(item => item.type === 'event' && item.name === name);
  return {
    address: lottery.address, blockHash, blockNumber: toHex(block), transactionHash: hash, transactionIndex: '0x0', logIndex: toHex(index), removed: false,
    topics: encodeEventTopics({ abi: lotteryAbi, eventName: name, args }),
    data: encodeAbiParameters(event.inputs.filter(i => !i.indexed), event.inputs.filter(i => !i.indexed).map(i => args[i.name])),
  };
}
export async function rpc(state, method, params = []) {
  state.calls.push({ method, params });
  if (state.rpcFail) throw Object.assign(Error('Mock RPC unavailable'), { code: -32000 });
  if (method === 'eth_chainId') return toHex(state.chainId);
  if (method === 'eth_blockNumber') return toHex(state.block);
  if (method === 'eth_getCode') return state.missingCode ? '0x' : '0x6001600055';
  if (method === 'eth_call') {
    const abi = params[0].to.toLowerCase() === token.address.toLowerCase() ? tokenAbi : lotteryAbi;
    const { functionName: fn, args = [] } = decodeFunctionData({ abi, data: params[0].data });
    const round = (state.block - state.genesis) / 300n;
    const r = typeof args[0] === 'bigint' ? args[0] : 0n;
    const values = {
      token: state.tokenMismatch ? other : token.address, deploymentBlock: state.genesis, currentRound: round,
      TICKET_PRICE: price, MAX_TICKETS_PER_BUY: 100n, ROUND_BLOCKS: 300n, HASH_WINDOW: 256n,
      decimals: 18, symbol: 'DRAW', balanceOf: state.balance, allowance: state.allowance,
      claimable: state.credit, ticketsOf: r === round ? state.tickets : r === 0n ? 5n : 3n,
      refunded: state.refundDone,
      closeBlock: state.genesis + 300n * (r ?? 0n) + 299n,
      drawBlock: state.genesis + 300n * (r ?? 0n) + 304n,
      roundInfo: r === round ? [100n, 5000n * unit, 0, zeroAddress, 0n] : [20n, 0n, r === 0n ? 2 : state.selectedState, state.selectedState === 1 ? account : zeroAddress, state.selectedState === 1 ? 19000n * unit : 0n],
    };
    if (fn in values) return encodeFunctionResult({ abi, functionName: fn, result: values[fn] });
    if (state.simulationFail) throw Object.assign(Error('execution reverted: HashUnavailable'), { code: 3, data: encodeErrorResult({ abi: lotteryAbi, errorName: 'HashUnavailable' }) });
    return fn === 'approve' ? encodeFunctionResult({ abi, functionName: fn, result: true }) : '0x';
  }
  if (method === 'eth_getLogs') {
    const block = state.genesis + 620n;
    return BigInt(params[0].fromBlock) <= block && BigInt(params[0].toBlock) >= block ? [
      eventLog('Settled', { r: 1n, winner: other, prize: 47500n * unit, carryOut: 2500n * unit }, block),
      eventLog('Settled', { r: 0n, winner: zeroAddress, prize: 0n, carryOut: 0n }, block, `0x${'ac'.repeat(32)}`, 1),
    ] : [];
  }
  if (method === 'eth_getTransactionReceipt') return state.receipts.get(params[0]) ?? null;
  if (method === 'eth_getBlockByNumber') return { number: toHex(state.block), hash: blockHash, timestamp: '0x68a00000', transactions: [], baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0' };
  throw Error(`Unhandled RPC ${method}`);
}
export async function walletRequest(state, { method, params = [] }) {
  state.calls.push({ method, params, wallet: true });
  if (method === 'eth_requestAccounts') {
    if (state.reject) return { error: { code: 4001, message: 'User rejected request' } };
    return { result: state.accounts };
  }
  if (method === 'eth_accounts') return { result: state.accounts };
  if (method === 'eth_chainId') return { result: toHex(state.walletChain) };
  if (method === 'wallet_switchEthereumChain') {
    if (state.unknownChain) return { error: { code: 4902, message: 'Unknown chain' } };
    state.walletChain = Number(BigInt(params[0].chainId));
    return { result: null };
  }
  if (method === 'wallet_addEthereumChain') { state.unknownChain = false; return { result: null }; }
  if (method === 'eth_sendTransaction') {
    if (state.reject) return { error: { code: 4001, message: 'User rejected request' } };
    const tx = params[0];
    const abi = tx.to.toLowerCase() === token.address.toLowerCase() ? tokenAbi : lotteryAbi;
    const decoded = decodeFunctionData({ abi, data: tx.data });
    state.transactions.push({ ...tx, ...decoded });
    const { functionName: fn, args = [] } = decoded;
    const hash = `0x${(state.transactions.length).toString(16).padStart(64, '0')}`;
    const logs = [];
    if (!state.receiptFail) {
      if (fn === 'approve') state.allowance = args[1];
      if (fn === 'buy') {
        state.balance -= args[0] * price; state.allowance -= args[0] * price; state.tickets += args[0];
        const r = state.rollover ? 4n : (state.block - state.genesis) / 300n;
        logs.push(eventLog('Bought', { r, buyer: account, count: args[0], endIndex: state.tickets }, state.block, hash));
      }
      if (fn === 'settle') { state.selectedState = state.block > state.genesis + args[0] * 300n + 560n ? 2 : 1; if (state.selectedState === 1) state.credit += 19000n * unit; }
      if (fn === 'refund') { state.credit += 5000n * unit; state.refundDone = true; }
      if (fn === 'claim') { state.balance += state.credit; state.credit = 0n; }
    }
    state.receipts.set(hash, { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: toHex(state.block), from: account, to: tx.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs, logsBloom: `0x${'00'.repeat(256)}`, status: state.receiptFail ? '0x0' : '0x1', type: '0x2' });
    return { result: hash };
  }
  return { result: await rpc(state, method, params) };
}
export async function installMock(page, state, { wallet = true, corruptAbi = false } = {}) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (corruptAbi && url.endsWith('/abi/LaunchToken.json')) return route.fulfill({ json: [] });
    if (!networkInput.network.rpcUrls.some(endpoint => url.startsWith(endpoint))) return route.continue();
    const request = route.request().postDataJSON();
    try { return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: await rpc(state, request.method, request.params) } }); }
    catch (error) { return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32000, message: error.message, data: error.data } } }); }
  });
  if (wallet) {
    await page.exposeFunction('__walletRequest', args => walletRequest(state, args));
    await page.addInitScript(() => {
      const listeners = {};
      window.ethereum = {
        request: async args => {
          const response = await window.__walletRequest(args);
          if (response.error) throw Object.assign(new Error(response.error.message), response.error);
          return response.result;
        },
        on: (event, callback) => { (listeners[event] ??= new Set()).add(callback); },
        removeListener: (event, callback) => listeners[event]?.delete(callback),
      };
      window.__emit = (event, payload) => listeners[event]?.forEach(callback => callback(payload));
    });
  }
}
