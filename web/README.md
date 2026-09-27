# DRAW frontend

A one-page React/TypeScript frontend for the deployed Sepolia BlockhashLottery. This is a test toy with no real value. Source lives entirely in `web/`; the publishable static export is `../dist/`. There is no server, indexer, API key, or wallet secret.

## Install, build, and preview

Use Node 22.12+ (worker: Node 24.21.0) and npm. Run from `web/`:

```sh
npm ci --cache /tmp/draw-npm-cache
npm run typecheck
npm run build
npm run verify
npm run preview -- --host 127.0.0.1
```

Open the URL printed by Vite. Preview serves the final export. Build invokes typecheck, Vite, and the manifest generator in sequence. Vite uses `base: './'`; this one-page app uses hash anchors and needs no route rewrites. All fonts and assets are local. Serve over HTTP(S), not `file://` (the runtime fetches JSON). Publish the entire `dist/` directory without rewriting its bytes. Nothing in the build reads `.imd/reads/`.

The ABI provenance check uses `git show` at the deployed source commit. Keep that Git object available when building; a source ZIP alone is insufficient for this check. A Vite chunk-size advisory for the approximately 532 kB JavaScript bundle is expected; the complete export is under 1 MiB.

## Deployment configuration

`config/handoff.json` and `config/network.json` are preserved copies of the pinned deployment inputs. They are build inputs, never independent runtime address maps. `scripts/export.mjs` copies the two raw ABI arrays from `web/abi/`, byte-compares them with `docs/abi/<Contract>.json` at the pinned commit, checks canonical Keccak-256, and writes `dist/imd-deployment.json` **after** Vite exports. Canonical JSON recursively sorts object keys, preserves array order, and removes insignificant whitespace. Both hashes match the handoff.

The generator copies the exact identifiers and contract set; `network` and `walletAddChain` are unchanged JSON objects from the supplied network file. It inventories every exported file except the manifest with lowercase SHA-256. `scripts/verify.mjs` checks the full inventory, relative paths, byte limits, ABI hashes, identifiers, and network equality. Rebuild after every exported-file change. Do not edit addresses in source or patch exported files manually.

`src/config.ts` fetches this same manifest at runtime and then loads and verifies the referenced ABI JSON. It creates the chain and public RPC fallback exclusively from the manifest. No private credentials or WalletConnect project ID are supplied or needed. Browser wallets exposing `window.ethereum` are supported; WalletConnect/mobile deep links and multi-provider discovery are not implemented. A wrong network exposes one switch control. Unknown-chain errors trigger the exact supplied `wallet_addEthereumChain` parameters, then another switch.

The public RPC clients verify chain ID and nonempty code for both contracts. `token()` must match the attested launch token; token balance, allowance, decimals, and symbol are read using that returned address. Reads at each refresh share one block number. Public RPCs are tried in supplied order, followed by the browser wallet only when it reports the correct chain. Read failures or data older than 30 seconds disable signing controls. Polling is every 12 seconds, with manual refresh.

## User flows

- Buy 1–100 tickets. The cost is read from `TICKET_PRICE()`. Approve the lottery for exactly the selected cost, wait for confirmation, then buy. Existing sufficient approval is shown as ready. No unlimited allowance. A mined `Bought` event supplies the actual round in the confirmation, since a round can change while a transaction is pending.
- View current pot, carry, tickets, sales-close and draw-block countdowns. Settlement starts strictly after the draw block.
- Look up any existing round; settle eligible rounds, including missed and empty rounds. Beyond `drawBlock + 256`, nonempty rounds expire. Credit a full ticket refund once, then claim.
- Claim the entire accumulated winnings/refund credit to the connected wallet. No transfer occurs merely because a round is settled or a refund is credited.
- View past winners from `Settled` events, scanned from `deploymentBlock()` in at most 2,000-block chunks. Empty-round settlements are excluded. Entries are deduplicated by transaction hash/log index; the latest 12 blocks are re-queried and replaced after catching up. A partial scan or failure is labeled. The history is in memory, uses no backend, and restarts on reload. Deep reorgs require a reload.

Every action refreshes prerequisites, verifies the wallet account and chain, and simulates before requesting a signature. Pending, rejected, reverted, confirmed, replaced, and timeout messages have transaction explorer links where a hash is available. Ordinary token amounts are displayed with up to four fractional digits; transaction arithmetic remains exact bigint minor units. Always check the wallet transaction details before signing.

The approved workflow explicitly says **no in-page swap**. Visitors obtain DRAW by swapping Sepolia ETH in the launch pool using an external interface. The page explains this and links to the deployed token. All supplied Uniswap addresses remain unchanged in the runtime network block; no quote, router, Permit2 approval, or swap is executed here. Ticket approvals use the lottery as spender.

## Validation

```sh
# Install the browser into a disposable directory if needed.
PLAYWRIGHT_BROWSERS_PATH=/tmp/draw-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/draw-browsers npm test

# Or use a compatible existing Chromium executable.
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm test

# Optional read-only deployed chain/code/token checks; no transactions.
node scripts/check-live.mjs
```

`npm test` serves the production export under `/preview/` in a bounded process and closes its server/browser afterward. RPC and browser wallet responses are mocked; no real transaction can be sent by these tests. Reports and screenshots are in `docs/evidence/`. See [validation](../docs/VALIDATION.md) for actual commands, results, scope conflicts, review coverage, and unperformed live-chain checks. See [design](../docs/DESIGN.md) for the implemented visual system.

## Contract assumptions

The source contracts remain unchanged. The lottery has no owner, pause, or upgrade path and holds DRAW rather than ETH. Randomness is a future blockhash: a Sepolia validator could withhold a block to change the outcome at the cost of its block reward. Sales close five blocks earlier, preventing buyers from seeing that hash first. This mechanism is unsuitable for valuable prizes. Settlement and claims require someone to send transactions; there is no automatic keeper. RPC providers and the hosting/deployment handoff remain trust dependencies. Runtime ABI equality is a consistency check, not independent authentication of a compromised site. Publication attestation/CID checks are the control plane's responsibility.

The worker did not broadcast, redeploy, publish, or independently re-certify the Solidity contracts. The supplied protected contract tests were read as scope/behavior inputs; frontend mocks do not replace their Solidity checks.

## Files and size budget

Only `web/**`, `dist/**`, and `docs/**` are delivered. The explicitly allowed `web/.gitignore` excludes dependency and cache directories at any nesting under `web/`; no other ignore file is changed. Dependencies are installed normally and represented by the lockfile. Do not add node_modules, archives, caches, vendored registries, source maps, or submodules. The static export includes required font license files. See `docs/evidence/submission-size.json` for the final byte audit.
