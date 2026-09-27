import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAddress, type Address, type Hash } from 'viem';
import { clientFor, loadRuntime, switchNetwork, type Runtime } from './config';
import { amount, eligibility, errorText, History, short, snapshot, transact, type Action, type Snapshot, type Winner } from './lottery';

function Mark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M5 5h12v12H5zM23 5h12v12H23zM5 23h12v12H5z" stroke="currentColor" strokeWidth="3"/><circle cx="29" cy="29" r="7" fill="currentColor"/></svg>;
}
const remaining = (target: bigint, block: bigint) => target > block ? (target - block).toString() : '0';
const integer = (value: string) => /^(0|[1-9]\d{0,76})$/.test(value);

export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [configError, setConfigError] = useState('');
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [data, setData] = useState<Snapshot>();
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [pending, setPending] = useState<Action>();
  const lock = useRef(false);
  const [retry, setRetry] = useState(0);
  const [countInput, setCountInput] = useState('1');
  const [selected, setSelected] = useState<bigint>();
  const [roundInput, setRoundInput] = useState('');
  const [roundError, setRoundError] = useState('');
  const [history, setHistory] = useState<{ winners: Winner[]; through: bigint; complete: boolean }>();
  const [historyError, setHistoryError] = useState('');
  const [visibleWinners, setVisibleWinners] = useState(5);
  const [now, setNow] = useState(Date.now());
  const wallet = window.ethereum;
  const correctChain = Boolean(runtime && walletChain === runtime.manifest.chainId);
  const client = useMemo(() => runtime ? clientFor(runtime, correctChain ? wallet : undefined) : undefined, [runtime, wallet, correctChain]);
  const eventHistory = useMemo(() => new History(), [runtime]);

  useEffect(() => {
    let active = true;
    loadRuntime().then(value => { if (active) setRuntime(value); }).catch(e => { if (active) setConfigError(errorText(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    const changedAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts?.[0] && isAddress(accounts[0]) ? accounts[0] as Address : undefined);
      setData(undefined);
    };
    const changedChain = (...args: unknown[]) => { setWalletChain(Number(BigInt(args[0] as string))); setData(undefined); };
    const disconnected = () => { setAccount(undefined); setWalletChain(undefined); setData(undefined); };
    wallet.on?.('accountsChanged', changedAccounts);
    wallet.on?.('chainChanged', changedChain);
    wallet.on?.('disconnect', disconnected);
    return () => {
      wallet.removeListener?.('accountsChanged', changedAccounts);
      wallet.removeListener?.('chainChanged', changedChain);
      wallet.removeListener?.('disconnect', disconnected);
    };
  }, [wallet]);
  useEffect(() => {
    if (!runtime || !client) return;
    let active = true;
    let running = false;
    setData(undefined);
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const value = await snapshot(client!, runtime!, account, selected);
        if (active) { setData(value); setReadError(''); }
      } catch (e) {
        if (active) { setReadError(errorText(e)); setData(undefined); }
      } finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => { active = false; clearInterval(timer); };
  }, [runtime, client, account, selected, retry]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data || !client || !runtime) return;
    let active = true;
    let timer: number;
    async function scan() {
      try {
        const result = await eventHistory.advance(client!, runtime!, data!.genesis, data!.block);
        if (!active) return;
        setHistory(result); setHistoryError('');
        if (!result.complete) timer = window.setTimeout(scan, 350);
      } catch (e) { if (active) setHistoryError(`Winner history is incomplete. ${errorText(e)}`); }
    }
    void scan();
    return () => { active = false; clearTimeout(timer); };
  }, [data?.block, client, runtime, eventHistory, retry]);

  const count = integer(countInput) ? BigInt(countInput) : 0n;
  const countValid = count >= 1n && count <= (data?.max ?? 100n);
  const cost = data ? data.price * count : 0n;
  const stale = Boolean(data && now - data.fetchedAt > 30_000);
  const ready = Boolean(account && correctChain && data && !stale && !readError && !pending);
  const can = data ? eligibility(data, count) : undefined;
  const units = data?.symbol ?? 'DRAW';
  const fmt = (value: bigint) => amount(value, data?.decimals);
  const explorer = runtime?.manifest.network.explorer;
  const networkName = runtime?.manifest.network.name ?? 'Sepolia';

  async function connect() {
    setError('');
    if (!wallet) { setError('No browser wallet found. Install an Ethereum browser wallet, then reload this page.'); return; }
    setConnecting(true);
    try {
      const accounts = await wallet.request({ method: 'eth_requestAccounts' }) as Address[];
      if (!accounts[0] || !isAddress(accounts[0])) throw Error('No account shared. Open your wallet and try connecting again.');
      setAccount(accounts[0]);
      setWalletChain(Number(BigInt(await wallet.request({ method: 'eth_chainId' }) as string)));
    } catch (e) { setError(errorText(e)); }
    finally { setConnecting(false); }
  }
  async function switchChain() {
    if (!wallet || !runtime) return;
    setConnecting(true); setError('');
    try { await switchNetwork(wallet, runtime); setWalletChain(Number(BigInt(await wallet.request({ method: 'eth_chainId' }) as string))); }
    catch (e) { setError(errorText(e)); }
    finally { setConnecting(false); }
  }
  async function action(name: Action) {
    if (lock.current || !ready || !runtime || !client || !wallet || !account || !data) return;
    lock.current = true;
    setPending(name); setError(''); setHash(undefined); setStatus('Checking your wallet and the latest round…');
    try { await transact(runtime, client, wallet, account, name, count, data.selected, (text, tx) => { setStatus(text); if (tx) setHash(tx); }); }
    catch (e) { setStatus(''); setError(`${errorText(e)} Refresh the page data before retrying.`); }
    finally { lock.current = false; setPending(undefined); setRetry(value => value + 1); }
  }
  function lookup(event: FormEvent) {
    event.preventDefault();
    if (!integer(roundInput) || !data || BigInt(roundInput) > data.round) { setRoundError(`Enter a round number from 0 to ${data?.round ?? 'the current round'}.`); document.getElementById('round-number')?.focus(); return; }
    setRoundError(''); setSelected(BigInt(roundInput));
  }
  const settlementLabel = data?.selectedInfo[2] === 1 ? 'Settled' : data?.selectedInfo[2] === 2 ? 'Expired' : data && data.block <= data.selectedDraw ? 'Waiting for draw' : 'Ready to settle';

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header page-width">
      <a className="brand" href="#main" aria-label="DRAW home"><Mark /><span>DRAW<span className="brand-caption">The block lottery</span></span></a>
      <div className="wallet-nav"><span className="network-badge"><span aria-hidden="true">◈</span> {networkName} testnet</span>
        {!account ? <button className="button dark" onClick={connect} disabled={connecting || !runtime}>{connecting ? 'Connecting…' : 'Connect wallet'} <span aria-hidden="true">↗</span></button> : <div className="connected"><a href={`${explorer}/address/${account}`} title={account} aria-label={`Connected wallet ${account}`}>{short(account)}</a><button className="text-button" disabled={Boolean(pending)} onClick={() => { setAccount(undefined); setData(undefined); setStatus('Wallet disconnected from this page.'); }}>Disconnect</button></div>}
      </div>
    </header>
    <main id="main" className="page-width">
      <section className="intro"><div><p className="eyebrow">An onchain experiment / No. 001</p><h1>A little luck.<br/>Every 300 blocks.</h1></div><div className="intro-note"><span className="asterisk" aria-hidden="true">✳</span><p>One ticket. One chance.<br/>{' '}A draw that anyone can settle.</p><p className="test-note">Sepolia test toy. No real value.</p></div></section>
      <div className="alerts">
        {configError && <p className="alert" role="alert">{configError} <button onClick={() => location.reload()}>Reload configuration</button></p>}
        {account && !correctChain && <div className="alert network-alert"><div><strong>Wrong network</strong><p>Switch your wallet to {networkName} to use this lottery.</p></div><button className="button dark" onClick={switchChain} disabled={connecting}>{connecting ? 'Switching…' : `Switch to ${networkName}`}</button></div>}
        {(readError || stale) && <div className="alert" role="alert"><p>{readError || 'The last read is stale. Actions are paused until fresh data arrives.'}</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>Retry reads</button></div>}
        <div className={error ? 'alert' : 'empty-status'} role="alert">{error}</div>
        <div className={status || hash ? 'transaction-status' : 'empty-status'} role="status">{status} {hash && <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>
      </div>
      <div className="play-grid">
        <section className="round-card" aria-labelledby="round-title">
          <div className="section-top"><h2 id="round-title">Round {data ? `#${data.round}` : '—'}</h2><span className="pill">{data ? 'Open for tickets' : 'Connecting to chain'}</span></div>
          <div className="pot"><p className="eyebrow">The current pot</p><div className="pot-number">{data ? fmt(data.info[0] * data.price + data.info[1]) : '—'} <span>{units}</span></div><p>95% to one winner. 5% carries forward.</p></div>
          <div className="countdowns"><div><span className="metric-label">Blocks until close</span><strong>{data ? remaining(data.close, data.block) : '—'}</strong><span className="small">{data ? `Last sales block ${data.close.toLocaleString()}` : 'Waiting for block data'}</span></div><div><span className="metric-label">Blocks until draw</span><strong>{data ? remaining(data.draw, data.block) : '—'}</strong><span className="small">Settle from the following block</span></div></div>
          <div className="round-footer"><span><strong>{data ? data.info[0].toLocaleString() : '—'}</strong> tickets in this round</span><span>{data ? fmt(data.info[1]) : '—'} {units} carried in</span></div>
        </section>
        <section className="ticket-card" aria-labelledby="buy-title">
          <div className="section-top"><p className="eyebrow">Your entry</p><span className="ticket-mark" aria-hidden="true">↗</span></div><h2 id="buy-title">Make it a ticket.</h2><p>{data ? fmt(data.price) : '1,000'} {units} per ticket</p>
          <label htmlFor="ticket-count">Number of tickets <span className="small">1–{data?.max.toString() ?? '100'} per purchase</span></label>
          <div className="stepper"><button aria-label="Remove one ticket" disabled={Boolean(pending) || count <= 1n} onClick={() => setCountInput((count - 1n).toString())}>−</button><input id="ticket-count" name="tickets" inputMode="numeric" autoComplete="off" value={countInput} disabled={Boolean(pending)} onChange={event => setCountInput(event.target.value)} aria-invalid={!countValid} aria-describedby="ticket-hint"/><button aria-label="Add one ticket" disabled={Boolean(pending) || count >= (data?.max ?? 100n)} onClick={() => setCountInput((count + 1n).toString())}>+</button></div>
          <p id="ticket-hint" className="small">{countValid ? 'Tickets enter the round in which your purchase is mined.' : `Enter a whole number from 1 to ${data?.max ?? 100n}.`}</p>
          <div className="ticket-total"><span>Total</span><strong>{data && countValid ? `${fmt(cost)} ${units}` : '—'}</strong></div>
          <div className="purchase-actions"><button className={can?.approve && ready ? 'button dark' : 'button outline'} disabled={!ready || !can?.approve} onClick={() => action('approve')}>{pending === 'approve' ? 'Approving…' : data && countValid && data.allowance >= cost && account ? '1. Approval ready ✓' : `1. Approve ${units}`}</button><button className={can?.buy && ready ? 'button dark' : 'button outline'} disabled={!ready || !can?.buy} onClick={() => action('buy')}>{pending === 'buy' ? 'Buying…' : `2. Buy ${countValid ? count : ''} ${count === 1n ? 'ticket' : 'tickets'}`}</button></div>
          <p className="small purchase-note">{!account ? 'Connect your wallet to approve and buy.' : !correctChain ? `Switch to ${networkName} to continue.` : data && countValid && data.balance < cost ? `You need ${fmt(cost - data.balance)} more ${units} for this purchase.` : `Approval allows the lottery to spend exactly this purchase’s ${units}. Each step is a separate transaction.`}</p>
          <div className="ticket-stub"><span>DRAW / {networkName}</span><span className="barcode" aria-hidden="true">▌▎▌▌▎▌▎▌▌▎▌▌</span></div>
        </section>
      </div>
      <section className="wallet-strip" aria-label="Your wallet balances"><div><span className="metric-label">Your balance</span><strong>{account && data ? `${fmt(data.balance)} ${units}` : 'Connect to view'}</strong></div><div><span className="metric-label">Lottery allowance</span><strong>{account && data ? `${fmt(data.allowance)} ${units}` : '—'}</strong></div><div><span className="metric-label">Your tickets this round</span><strong>{account && data ? data.tickets.toString() : '—'}</strong></div><p>Need DRAW? Swap {networkName} ETH for DRAW in the launch pool using an external interface. This page has no swap. <a href={runtime ? `${explorer}/address/${runtime.token.address}` : undefined}>View DRAW token ↗</a></p></section>
      <div className="manage-grid">
        <section className="manage-card" aria-labelledby="settle-title"><div className="section-top"><h2 id="settle-title">Keep the draw moving.</h2><span className="section-number" aria-hidden="true">01</span></div><p>Anyone can settle a round after its draw block.</p>
          <form className="round-lookup" onSubmit={lookup}><div><label htmlFor="round-number">Round number</label><input id="round-number" name="round" inputMode="numeric" autoComplete="off" value={roundInput} placeholder={data?.selected.toString() ?? '0'} onChange={event => setRoundInput(event.target.value)} aria-invalid={Boolean(roundError)} aria-describedby="round-hint"/></div><button className="button outline" disabled={!data || Boolean(pending)}>Look up round</button></form><p id="round-hint" className="small">{roundError || 'The previous round is selected by default. Look up any earlier round for settlement or refunds.'}</p>
          <div className="round-detail"><div><strong>Round {data ? `#${data.selected}` : '—'}</strong><span>{data ? settlementLabel : 'Loading…'}</span></div>{data && <p className="small">{data.selectedInfo[2] === 1 ? `Prize credited: ${fmt(data.selectedInfo[4])} ${units}.` : data.selectedInfo[2] === 2 ? 'The draw window expired. Buyers can credit a full ticket refund.' : data.block <= data.selectedDraw ? `Settlement opens in ${remaining(data.selectedDraw + 1n, data.block)} blocks.` : data.block > data.selectedDraw + data.window ? 'The draw window has passed. Settle to enable ticket refunds; empty rounds only forward carry.' : `${remaining(data.selectedDraw + data.window, data.block)} blocks remain after this block before the draw expires.`} {account && `You bought ${data.selectedTickets} tickets.${data.refunded ? ' Refund already credited.' : ''}`}</p>}</div>
          <div className="action-row"><button className="button outline" disabled={!ready || !can?.settle} onClick={() => action('settle')}>{pending === 'settle' ? 'Settling…' : 'Settle round'}</button><button className="button outline" disabled={!ready || !can?.refund} onClick={() => action('refund')}>{pending === 'refund' ? 'Crediting…' : 'Credit refund'}</button></div><p className="small">Refunds become claimable credit. Use “Claim DRAW” to withdraw.</p>
        </section>
        <section className="manage-card claim-card" aria-labelledby="claim-title"><div className="section-top"><h2 id="claim-title">Yours to claim.</h2><span className="section-number" aria-hidden="true">02</span></div><p>Winnings and credited refunds, together.</p><div className="claim-amount">{account && data ? fmt(data.claimable) : '—'} <span>{units}</span></div><button className="button outline" disabled={!ready || !can?.claim} onClick={() => action('claim')}>{pending === 'claim' ? 'Claiming…' : `Claim ${units}`} <span aria-hidden="true">↗</span></button><p className="small">{!account ? 'Connect your wallet to see your claimable balance.' : data?.claimable === 0n ? 'No credit to claim yet. Settled winnings and credited refunds appear here.' : 'Transfers your entire claimable balance to your connected wallet.'}</p><div className="mini-rule"><span aria-hidden="true">↳</span><p>Nothing moves automatically.<br/>Your wallet signs each action.</p></div></section>
      </div>
      <section className="winners" aria-labelledby="winners-title"><div className="section-top"><div><p className="eyebrow">The record</p><h2 id="winners-title">Past winners</h2></div><span className="small">From onchain settlement events</span></div>
        {historyError && <p role="alert" className="alert">{historyError} <button className="text-button" onClick={() => setRetry(value => value + 1)}>Retry history</button></p>}
        {history?.winners.length ? <div className="winner-table"><table><caption className="sr-only">Winning rounds, wallets, and credited DRAW prizes</caption><thead><tr><th scope="col">Round</th><th scope="col">Winner</th><th scope="col">Prize credited</th></tr></thead><tbody>{history.winners.slice(0, visibleWinners).map(winner => <tr key={`${winner.hash}:${winner.index}`}><td><a href={`${explorer}/tx/${winner.hash}`} aria-label={`Round ${winner.round} settlement transaction`}>#{winner.round.toString()} ↗</a></td><td><a href={`${explorer}/address/${winner.winner}`} title={winner.winner} aria-label={`Winner ${winner.winner}`}>{short(winner.winner)}</a></td><td>{fmt(winner.prize)} <span>{units}</span></td></tr>)}</tbody></table>{history.winners.length > visibleWinners && <button className="text-button" onClick={() => setVisibleWinners(value => value + 10)}>Show more winners</button>}</div> : <div className="empty-winners"><span aria-hidden="true">↗</span><div><strong>{history?.complete ? 'The first winner is still to come.' : 'Reading the draw’s history…'}</strong><p>{history?.complete ? 'Settle an eligible round to put its winner on the record.' : 'Scanning contract events from the deployment block. Results appear as they arrive.'}</p></div></div>}
        {history && <p className="small">Scanned through block {history.through.toLocaleString()}{history.complete ? '. Recent events may change during a chain reorganization.' : ' · Scan in progress; this list is partial.'}</p>}
      </section>
      <section className="how-it-works" aria-label="How the lottery works"><div><span>01 / Enter</span><p>1,000 DRAW buys one ticket. Sales run for 300 blocks.</p></div><div><span>02 / Draw</span><p>Five blocks after sales close, a future blockhash selects a winner when someone settles.</p></div><div><span>03 / Collect</span><p>The winner gets 95%. The rest rolls on. Miss the 256-block settlement window? Ticket buyers can refund.</p></div></section>
      <details className="details"><summary>Experiment notes &amp; deployment</summary><div><p>This is a Sepolia test toy with no real value. A validator could withhold a block to influence the outcome at the cost of its block reward. This randomness is unsuitable for valuable prizes. Purchases close five blocks before the draw hash. There is no owner, admin, oracle, or automatic keeper.</p><p>Settle strictly after the draw block and within 256 blocks to draw. After that, settle marks a nonempty round expired; each buyer credits a full refund, then claims. Empty rounds forward their carry. Network fees use Sepolia ETH; the lottery only receives DRAW.</p>{runtime && <><dl><dt>Launch</dt><dd>{runtime.manifest.launchId}</dd><dt>Deployed source</dt><dd>{runtime.manifest.sourceCommit}</dd><dt>Attestation</dt><dd>{runtime.manifest.attestationHash}</dd>{runtime.manifest.contracts.map(contract => <div key={contract.name}><dt>{contract.name}</dt><dd><a href={`${explorer}/address/${contract.address}`}>{contract.address} ↗</a></dd></div>)}</dl><p><a href="./imd-deployment.json">View deployment configuration</a></p>{account && <p className="full-address">Connected wallet: {account}</p>}</>}</div></details>
    </main>
    <footer className="page-width"><span className="footer-brand">DRAW <span>Small stakes. Open code.</span></span><div className="read-status"><span>{data ? `Block ${data.block.toLocaleString()} · ${stale ? 'Stale' : 'Live reads · refresh every 12s'}` : readError ? 'RPC unavailable' : 'Loading deployment…'}</span><button className="text-button" onClick={() => setRetry(value => value + 1)} disabled={!runtime}>Refresh</button></div></footer>
  </>;
}
