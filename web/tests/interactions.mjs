import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixture, installMock, account, lottery } from './fixture.mjs';
import { root, out, networkInput } from '../scripts/shared.mjs';

const evidence = resolve(root, 'docs/evidence');
await mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/preview\//, '');
  const path = resolve(out, relative || 'index.html');
  if (!path.startsWith(out + '/')) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
const results = [];
const capture = {};
const browserErrors = [];
const resourceFailures = [];
async function check(name, callback) {
  await callback(); results.push({ name, result: 'passed' }); console.log(`PASS ${name}`);
}
async function open(state = fixture(), options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(url) && response.status() >= 400) resourceFailures.push({ url: response.url(), status: response.status() }); });
  await installMock(page, state, options);
  await page.goto(url);
  return page;
}
const connect = async page => { await page.getByRole('button', { name: 'Connect wallet' }).click(); await expect(page.getByRole('link', { name: `Connected wallet ${account}` })).toBeVisible(); };
const refresh = async page => { await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Round #3', exact: true })).toBeVisible(); };
const approve = page => page.getByRole('button', { name: '1. Approve DRAW', exact: true });
const buy = page => page.getByRole('button', { name: /^2\. Buy/ });
try {
  const state = fixture();
  const page = await open(state);
  await check('Subpath export, disconnected live reads, disabled actions and event winners', async () => {
    await expect(page.getByRole('heading', { name: 'Round #3', exact: true })).toBeVisible();
    await expect(approve(page)).toBeDisabled(); await expect(buy(page)).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Round 1 settlement transaction' })).toBeVisible();
    assert.equal(await page.locator('tbody tr').count(), 1);
    assert(state.calls.filter(c => c.method === 'eth_getLogs').every(c => BigInt(c.params[0].toBlock) - BigInt(c.params[0].fromBlock) < 2000n));
    assert.equal(BigInt(state.calls.find(c => c.method === 'eth_getLogs').params[0].fromBlock), state.genesis);
  });
  await check('Wallet connection and exact approval before buy', async () => {
    await connect(page); await expect(approve(page)).toBeEnabled(); await expect(buy(page)).toBeDisabled();
    await page.getByLabel('Number of tickets').fill('2'); await approve(page).click();
    await expect(page.getByRole('status')).toContainText('Approval confirmed');
    assert.equal(state.transactions[0].functionName, 'approve');
    assert.equal(state.transactions[0].args[0].toLowerCase(), lottery.address.toLowerCase());
    assert.equal(state.transactions[0].args[1], 2000n * 10n ** 18n);
    await expect(buy(page)).toBeEnabled();
  });
  await check('Buy receipt reports actual mining round; balance and allowance refresh', async () => {
    state.rollover = true; await buy(page).click();
    await expect(page.getByRole('status')).toContainText('Tickets purchased in round #4');
    await expect(approve(page)).toBeEnabled();
    assert.equal(state.transactions[1].functionName, 'buy'); assert.equal(state.transactions[1].args[0], 2n);
    assert.equal(state.allowance, 0n);
  });
  await check('Ticket limits, fractions, exponential notation and insufficient balance', async () => {
    for (const value of ['0', '101', '1.5', '1e2', '-1', '']) { await page.getByLabel('Number of tickets').fill(value); await expect(approve(page)).toBeDisabled(); await expect(buy(page)).toBeDisabled(); }
    await page.getByLabel('Number of tickets').fill('1'); state.balance = 0n; await refresh(page);
    await expect(approve(page)).toBeDisabled(); await expect(page.getByText('You need 1,000 more DRAW for this purchase.')).toBeVisible();
    state.balance = 500000n * 10n ** 18n; await refresh(page);
  });
  await check('Wallet rejection preserves balances and allows retry', async () => {
    state.reject = true; await approve(page).click(); await expect(page.getByRole('alert')).toContainText('Request declined');
    assert.equal(state.transactions.length, 2); state.reject = false;
    await expect(approve(page)).toBeEnabled();
  });
  await check('Simulation revert never asks for a signature', async () => {
    state.simulationFail = true; const before = state.calls.filter(c => c.method === 'eth_sendTransaction').length;
    await page.getByRole('button', { name: 'Settle round', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('HashUnavailable');
    assert.equal(state.calls.filter(c => c.method === 'eth_sendTransaction').length, before);
    state.simulationFail = false;
  });
  await check('Settle credits prize and prevents a second settlement', async () => {
    await page.getByRole('button', { name: 'Settle round', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Round settled');
    await expect(page.getByRole('button', { name: 'Settle round', exact: true })).toBeDisabled();
    assert.equal(state.selectedState, 1);
  });
  await check('Expired-round lookup, refund credit, double-refund guard, and claim', async () => {
    await page.getByLabel('Round number').fill('0'); await page.getByRole('button', { name: 'Look up round' }).click();
    await expect(page.getByRole('button', { name: 'Credit refund' })).toBeEnabled();
    await page.getByRole('button', { name: 'Credit refund' }).click(); await expect(page.getByRole('status')).toContainText('Refund credited');
    await expect(page.getByRole('button', { name: 'Credit refund' })).toBeDisabled();
    await page.getByRole('button', { name: 'Claim DRAW' }).click(); await expect(page.getByRole('status')).toContainText('DRAW claimed');
    await expect(page.getByRole('button', { name: 'Claim DRAW' })).toBeDisabled(); assert.equal(state.credit, 0n);
  });
  await check('Future round validation keeps current data and focuses field', async () => {
    await page.getByLabel('Round number').fill('99999'); await page.getByRole('button', { name: 'Look up round' }).click();
    await expect(page.getByLabel('Round number')).toHaveAttribute('aria-invalid', 'true'); await expect(page.getByLabel('Round number')).toBeFocused();
  });
  await check('Unknown chain offers exact add-chain data then switches again', async () => {
    state.walletChain = 1; state.unknownChain = true;
    await page.evaluate(() => window.__emit('chainChanged', '0x1'));
    await expect(page.getByText('Wrong network', { exact: true })).toBeVisible(); await expect(approve(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click();
    await expect(page.getByText('Wrong network', { exact: true })).toHaveCount(0);
    assert.deepEqual(state.calls.find(c => c.method === 'wallet_addEthereumChain').params[0], networkInput.walletAddChain);
    assert.equal(state.calls.filter(c => c.method === 'wallet_switchEthereumChain').length, 2);
  });
  await check('Account removal clears wallet state and disables transactions', async () => {
    state.accounts = []; await page.evaluate(() => window.__emit('accountsChanged', []));
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible(); await expect(buy(page)).toBeDisabled();
  });
  await page.close();

  for (const [name, flags, text] of [
    ['Missing contract code blocks transactions', { missingCode: true }, 'Deployed contract code is unavailable'],
    ['RPC chain mismatch blocks transactions', { chainId: 1 }, 'RPC network mismatch'],
    ['Token pointer mismatch blocks transactions', { tokenMismatch: true }, 'lottery token does not match'],
    ['RPC failure shows recoverable error', { rpcFail: true }, 'RPC error'],
  ]) await check(name, async () => {
    const invalid = Object.assign(fixture(), flags); const page = await open(invalid); await connect(page);
    await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible({ timeout: 20000 }); await expect(buy(page)).toBeDisabled();
    assert.equal(invalid.transactions.length, 0);
    if (flags.rpcFail) { invalid.rpcFail = false; await page.getByRole('button', { name: 'Retry reads' }).click(); await expect(approve(page)).toBeEnabled(); }
    await page.close();
  });
  await check('ABI tampering fails closed', async () => {
    const page = await open(fixture(), { corruptAbi: true }); await expect(page.getByRole('alert').filter({ hasText: 'ABI verification failed' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeDisabled(); await page.close();
  });
  await check('Missing browser wallet explains recovery', async () => {
    const page = await open(fixture(), { wallet: false }); await page.getByRole('button', { name: 'Connect wallet' }).click(); await expect(page.getByRole('alert')).toContainText('No browser wallet found'); await page.close();
  });
  await check('Draw boundary: strict > drawBlock, inclusive +256, expiry at +257', async () => {
    for (const [offset, enabled, text] of [[904n, false, 'Settlement opens in 1 blocks'], [905n, true, '255 blocks remain'], [1160n, true, '0 blocks remain'], [1161n, true, 'draw window has passed']]) {
      const state = fixture(); state.block = state.genesis + offset; const page = await open(state); await connect(page);
      const button = page.getByRole('button', { name: 'Settle round', exact: true });
      if (enabled) await expect(button).toBeEnabled(); else await expect(button).toBeDisabled();
      await expect(page.getByText(text, { exact: false })).toBeVisible(); await page.close();
    }
  });
  await check('Reverted receipt is not reported as success', async () => {
    const state = fixture(); state.receiptFail = true; const page = await open(state); await connect(page); await approve(page).click();
    await expect(page.getByRole('alert')).toContainText('transaction reverted'); assert.equal(state.allowance, 0n); await page.close();
  });
  await check('Stale reads pause actions until a fresh snapshot', async () => {
    const state = fixture(); const page = await open(state); await connect(page); await expect(approve(page)).toBeEnabled();
    await page.evaluate(() => { window.__originalNow = Date.now; Date.now = () => window.__originalNow() + 31000; });
    await expect(page.getByRole('alert').filter({ hasText: 'last read is stale' })).toBeVisible(); await expect(approve(page)).toBeDisabled();
    await page.evaluate(() => { Date.now = window.__originalNow; }); await page.getByRole('button', { name: 'Retry reads' }).click(); await expect(approve(page)).toBeEnabled(); await page.close();
  });
  await check('History scans every chunk from deployment without duplicate winners', async () => {
    const state = fixture(); state.block = state.genesis + 5200n; const page = await open(state);
    await expect(page.getByText(`Scanned through block ${state.block.toLocaleString()}`, { exact: false })).toBeVisible();
    const logs = state.calls.filter(c => c.method === 'eth_getLogs'); assert(logs.length >= 3);
    assert(logs.every(c => BigInt(c.params[0].toBlock) - BigInt(c.params[0].fromBlock) < 2000n));
    assert.equal(await page.locator('tbody tr').count(), 1); await page.close();
  });
  await check('Recent event blocks are re-queried when the head advances', async () => {
    const state = fixture(); const page = await open(state); await expect(page.getByRole('link', { name: 'Round 1 settlement transaction' })).toBeVisible();
    const previousHead = state.block; state.block += 1n; await refresh(page);
    await expect(page.getByText(`Scanned through block ${state.block.toLocaleString()}`, { exact: false })).toBeVisible();
    const request = state.calls.filter(c => c.method === 'eth_getLogs').at(-1);
    assert(BigInt(request.params[0].fromBlock) <= previousHead - 12n); assert.equal(await page.locator('tbody tr').count(), 1); await page.close();
  });
  await check('Desktop, intermediate, mobile, 320px reflow, keyboard, reduced motion and axe', async () => {
    const state = fixture(); const page = await open(state); await connect(page);
    await expect(approve(page)).toBeEnabled(); await page.evaluate(() => document.fonts.ready);
    capture.fonts = await page.evaluate(() => ({ dmSans: document.fonts.check('400 16px "DM Sans"'), spaceGrotesk: document.fonts.check('500 32px "Space Grotesk"') }));
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      await page.screenshot({ path: resolve(evidence, `mock-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    capture.axe = { violations: audit.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: audit.passes.length };
    assert.deepEqual(capture.axe.violations, []);
    await page.keyboard.press('Control+Home'); await page.locator('body').click({ position: { x: 1, y: 1 } }); await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter'); await page.getByLabel('Number of tickets').focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('3'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await expect(approve(page)).toBeFocused(); await page.screenshot({ path: resolve(evidence, 'keyboard-focus.png'), fullPage: true });
    await page.keyboard.press('Enter'); await expect(page.getByRole('status')).toContainText('Approval confirmed');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.button').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    capture.consoleErrors = browserErrors; capture.resourceFailures = resourceFailures; assert.deepEqual(browserErrors, []); assert.deepEqual(resourceFailures, []); await page.close();
  });
} finally {
  await writeFile(resolve(evidence, 'interaction-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), mode: 'production export; mocked RPC and browser wallet; no broadcasts', results, capture }, null, 2) + '\n');
  await browser.close(); await new Promise(done => server.close(done));
}
console.log(`${results.length} interaction checks passed.`);
