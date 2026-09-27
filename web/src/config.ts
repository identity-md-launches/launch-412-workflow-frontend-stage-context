import { createPublicClient, custom, defineChain, fallback, http, isAddress, keccak256, toBytes, type Abi, type Address, type EIP1193Provider } from 'viem';

export interface BrowserWallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
declare global { interface Window { ethereum?: BrowserWallet } }
export interface Deployment {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: Deployment['network']['nativeCurrency']; blockExplorerUrls: string[] };
}
export interface Runtime {
  manifest: Deployment;
  lottery: { address: Address; abi: Abi };
  token: { address: Address; abi: Abi };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) throw Error(`Unable to load ${path}. Reload the page to retry.`);
  return response.json();
}
export async function loadRuntime(): Promise<Runtime> {
  const manifest = await json('./imd-deployment.json') as Deployment;
  if (manifest.version !== 1 || !manifest.network?.rpcUrls.length || manifest.chainId !== manifest.network.chainId || Number(BigInt(manifest.walletAddChain.chainId)) !== manifest.chainId) throw Error('Deployment configuration is inconsistent. Transactions are disabled.');
  if (manifest.contracts.length !== 2 || new Set(manifest.contracts.map(c => c.name)).size !== 2) throw Error('Unexpected deployment contract set.');
  const loaded = await Promise.all(manifest.contracts.map(async contract => {
    if (!isAddress(contract.address) || !/^[a-f0-9]{64}$/.test(contract.abiHash) || !/^[\w/-]+\.json$/.test(contract.abiPath) || contract.abiPath.startsWith('/') || contract.abiPath.includes('..')) throw Error('Invalid contract configuration.');
    const abi = await json(`./${contract.abiPath}`) as Abi;
    if (!Array.isArray(abi) || keccak256(toBytes(canonical(abi))).slice(2) !== contract.abiHash) throw Error(`${contract.name} ABI verification failed. Transactions are disabled.`);
    return { ...contract, abi };
  }));
  const lottery = loaded.find(c => c.name === 'BlockhashLottery');
  const token = loaded.find(c => c.name === 'LaunchToken');
  if (!lottery || !token) throw Error('Required contracts are missing.');
  return { manifest, lottery, token };
}
export function chainFor(runtime: Runtime) {
  const { network, chainId } = runtime.manifest;
  return defineChain({ id: chainId, name: network.name, nativeCurrency: network.nativeCurrency, rpcUrls: { default: { http: network.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: network.explorer } }, testnet: network.testnet });
}
export function clientFor(runtime: Runtime, wallet?: BrowserWallet) {
  const transports = runtime.manifest.network.rpcUrls.map(url => http(url, { timeout: 8_000, retryCount: 0, batch: false }));
  return createPublicClient({ chain: chainFor(runtime), transport: fallback([...transports, ...(wallet ? [custom(wallet as EIP1193Provider, { retryCount: 0 })] : [])], { retryCount: 0 }), pollingInterval: 4_000 });
}
export async function switchNetwork(wallet: BrowserWallet, runtime: Runtime) {
  const chainId = runtime.manifest.walletAddChain.chainId;
  try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    const detail = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (detail.code !== 4902 && detail.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(detail.message ?? '')) throw error;
    await wallet.request({ method: 'wallet_addEthereumChain', params: [runtime.manifest.walletAddChain] });
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
