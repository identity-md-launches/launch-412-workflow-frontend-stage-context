import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, decodeEventLog, formatUnits, getAbiItem, zeroAddress, type Address, type EIP1193Provider, type Hash } from 'viem';
import { chainFor, clientFor, type BrowserWallet, type Runtime } from './config';

export type Client = ReturnType<typeof clientFor>;
export type RoundInfo = readonly [bigint, bigint, number, Address, bigint];
export interface Snapshot {
  block: bigint; round: bigint; genesis: bigint; price: bigint; max: bigint; span: bigint; window: bigint;
  close: bigint; draw: bigint; info: RoundInfo; decimals: number; symbol: string;
  balance: bigint; allowance: bigint; claimable: bigint; tickets: bigint;
  selected: bigint; selectedInfo: RoundInfo; selectedDraw: bigint; selectedTickets: bigint; refunded: boolean;
  fetchedAt: number;
}
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export function amount(value: bigint, decimals = 18) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = fraction?.slice(0, 4).replace(/0+$/, '');
  return `${grouped}${tail ? `.${tail}` : ''}`;
}
export function errorText(error: unknown) {
  if (error instanceof Error && error.name === 'WaitForTransactionReceiptTimeoutError') return 'Confirmation is taking longer than expected. This transaction may still be pending. Check its explorer status before sending another.';
  if (error instanceof BaseError) {
    const revert = error.walk(cause => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name === 'HashUnavailable') return 'The draw block hash is unavailable (HashUnavailable). Retry while the draw window is open.';
      if (name) return `The contract declined this action (${name}). Check the round and balances, then retry.`;
      if (revert.reason) return `The contract declined this action: ${revert.reason}`;
    }
  }
  const text = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/reject|denied|4001/i.test(text)) return 'Request declined in your wallet. You can try again when ready.';
  return text.length > 450 ? text.slice(0, 450) + '…' : text;
}
export async function verifyChain(client: Client, runtime: Runtime) {
  const id = await client.getChainId();
  if (id !== runtime.manifest.chainId) throw Error('RPC network mismatch. Transactions are disabled. Retry with the configured network.');
  const codes = await Promise.all([runtime.lottery, runtime.token].map(({ address }) => client.getCode({ address })));
  if (codes.some(code => !code || code === '0x')) throw Error('Deployed contract code is unavailable. Transactions are disabled. Retry the connection.');
}
export async function snapshot(client: Client, runtime: Runtime, account?: Address, selected?: bigint): Promise<Snapshot> {
  await verifyChain(client, runtime);
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({ ...runtime.lottery, functionName, args, blockNumber: block });
  const [tokenAddress, round, genesis, price, max, span, window] = await Promise.all(['token', 'currentRound', 'deploymentBlock', 'TICKET_PRICE', 'MAX_TICKETS_PER_BUY', 'ROUND_BLOCKS', 'HASH_WINDOW'].map(name => read(name))) as [Address, bigint, bigint, bigint, bigint, bigint, bigint];
  if (tokenAddress.toLowerCase() !== runtime.token.address.toLowerCase()) throw Error('The lottery token does not match the deployment. Transactions are disabled.');
  const chosen = selected ?? (round > 0n ? round - 1n : 0n);
  if (chosen > round) throw Error('Choose an existing round, up to the current round.');
  const token = { ...runtime.token, address: tokenAddress };
  const tokenRead = (functionName: string, args?: readonly unknown[]) => client.readContract({ ...token, functionName, args, blockNumber: block });
  const [close, draw, info, decimals, symbol, selectedInfo, selectedDraw] = await Promise.all([read('closeBlock', [round]), read('drawBlock', [round]), read('roundInfo', [round]), tokenRead('decimals'), tokenRead('symbol'), read('roundInfo', [chosen]), read('drawBlock', [chosen])]) as [bigint, bigint, RoundInfo, number, string, RoundInfo, bigint];
  const [balance, allowance, claimable, tickets, selectedTickets, refunded] = account ? await Promise.all([tokenRead('balanceOf', [account]), tokenRead('allowance', [account, runtime.lottery.address]), read('claimable', [account]), read('ticketsOf', [round, account]), read('ticketsOf', [chosen, account]), read('refunded', [chosen, account])]) as [bigint, bigint, bigint, bigint, bigint, boolean] : [0n, 0n, 0n, 0n, 0n, false];
  return { block, round, genesis, price, max, span, window, close, draw, info, decimals, symbol, balance, allowance, claimable, tickets, selected: chosen, selectedInfo, selectedDraw, selectedTickets, refunded, fetchedAt: Date.now() };
}
export type Action = 'approve' | 'buy' | 'settle' | 'refund' | 'claim';
export function eligibility(state: Snapshot, count: bigint) {
  const cost = state.price * count;
  return {
    approve: count >= 1n && count <= state.max && state.balance >= cost && state.allowance < cost,
    buy: count >= 1n && count <= state.max && state.balance >= cost && state.allowance >= cost,
    settle: state.selectedInfo[2] === 0 && state.block > state.selectedDraw,
    refund: state.selectedInfo[2] === 2 && state.selectedTickets > 0n && !state.refunded,
    claim: state.claimable > 0n,
  };
}
export async function transact(runtime: Runtime, client: Client, wallet: BrowserWallet, account: Address, action: Action, count: bigint, round: bigint, onStatus: (text: string, hash?: Hash) => void) {
  // Re-read prerequisites immediately before simulation, including account and chain.
  const assertWallet = async () => {
    const [id, accounts] = await Promise.all([wallet.request({ method: 'eth_chainId' }), wallet.request({ method: 'eth_accounts' })]);
    if (Number(BigInt(id as string)) !== runtime.manifest.chainId) throw Error(`Switch to ${runtime.manifest.network.name} before continuing.`);
    if ((accounts as string[])[0]?.toLowerCase() !== account.toLowerCase()) throw Error('Wallet account changed. Refresh and try again.');
  };
  await assertWallet();
  const fresh = await snapshot(client, runtime, account, round);
  if (!eligibility(fresh, count)[action]) throw Error('This action is no longer available. Refresh the round and check your balance or allowance.');
  const target = action === 'approve' ? runtime.token : runtime.lottery;
  const args = action === 'approve' ? [runtime.lottery.address, count * fresh.price] : action === 'buy' ? [count] : action === 'settle' || action === 'refund' ? [round] : [];
  onStatus('Checking the transaction…');
  const { request } = await client.simulateContract({ ...target, functionName: action, args, account });
  await assertWallet();
  onStatus('Confirm the transaction in your wallet.');
  const signer = createWalletClient({ chain: chainFor(runtime), transport: custom(wallet as EIP1193Provider), account });
  const hash = await signer.writeContract(request);
  onStatus('Transaction submitted. Waiting for confirmation…', hash);
  let differentTransaction = false;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000, onReplaced: replacement => {
    differentTransaction = replacement.reason !== 'repriced';
    onStatus('Transaction replaced. Waiting for confirmation…', replacement.transaction.hash);
  } });
  if (differentTransaction) throw Error('The transaction was cancelled or replaced with a different action. Check the explorer and refresh your balances.');
  if (receipt.status !== 'success') throw Error('The transaction reverted. Check its explorer details, refresh, and try again.');
  let message = `${{ approve: 'Approval confirmed. You can now buy tickets.', buy: 'Tickets purchased.', settle: 'Round settled. Refreshing the result.', refund: 'Refund credited. Claim it to withdraw DRAW.', claim: 'DRAW claimed to your wallet.' }[action]}`;
  if (action === 'buy') {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== runtime.lottery.address.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: runtime.lottery.abi, eventName: 'Bought', data: log.data, topics: log.topics });
        const values = decoded.args as unknown as { r: bigint };
        message = `Tickets purchased in round #${values.r}.`;
      } catch { /* Other receipt events are not purchases. */ }
    }
  }
  onStatus(message, receipt.transactionHash);
}
export interface Winner { round: bigint; winner: Address; prize: bigint; hash: Hash; block: bigint; index: number }
export class History {
  private next?: bigint;
  private entries = new Map<string, Winner>();
  async advance(client: Client, runtime: Runtime, genesis: bigint, head: bigint) {
    // Scan a bounded page from deployment, then overlap 12 blocks to replace shallow reorgs.
    const start = this.next ?? genesis;
    const from = start > head ? (head > genesis + 12n ? head - 12n : genesis) : start;
    const to = from + 1999n < head ? from + 1999n : head;
    const event = getAbiItem({ abi: runtime.lottery.abi, name: 'Settled' });
    if (!event || event.type !== 'event') throw Error('Settled event is missing from the ABI.');
    const logs = await client.getLogs({ address: runtime.lottery.address, event, fromBlock: from, toBlock: to, strict: true });
    for (const [key, entry] of this.entries) if (entry.block >= from) this.entries.delete(key);
    for (const log of logs) {
      const args = log.args as unknown as { r: bigint; winner: Address; prize: bigint };
      if (args.winner === zeroAddress || args.prize === 0n || !log.transactionHash || log.blockNumber === null || log.logIndex === null) continue;
      this.entries.set(`${log.transactionHash}:${log.logIndex}`, { round: args.r, winner: args.winner, prize: args.prize, hash: log.transactionHash, block: log.blockNumber, index: log.logIndex });
    }
    this.next = to >= head ? (to > genesis + 12n ? to - 12n : genesis) : to + 1n;
    return { winners: [...this.entries.values()].sort((a, b) => a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1), through: to, complete: to >= head };
  }
}
