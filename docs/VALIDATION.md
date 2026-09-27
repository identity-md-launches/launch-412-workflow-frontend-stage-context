# Frontend validation — DRAW

Worker report for 2026-09-27. These checks are local evidence, not independent certification. No transactions were broadcast, no contracts were changed or redeployed, and no site was published.

## Scope and decisions

Read all seven pinned inputs, including the workflow, handoff, network table, Better Interface guide/core principles in all six domains/documentation method, and both protected Solidity tests. The deployed source commit is `626e9c56939a86d30b897b87e4fa3054b99e1ece`, which was the checkout's HEAD when work began. Existing Solidity, Foundry configuration, remappings, libraries, root configuration, and prior documentation are unchanged.

The approved workflow explicitly prohibits an in-page swap. This app therefore implements lottery approval/buy/settle/refund/claim, explains external ETH-to-DRAW acquisition, and preserves the supplied Uniswap network data without executing swaps or Permit2 approvals. The optional generic swap reference does not expand this workflow.

The root `DESIGN.md` request conflicts with the overriding allowed paths. Its complete content is delivered at `docs/DESIGN.md`; no root file or additional ignore file was created. The explicit `web/.gitignore` allowance is used for dependency/cache exclusions at all nesting levels under `web/`.

## Checks run

| Check | Actual result |
| --- | --- |
| npm dependency installation | Succeeded using `/tmp/draw-npm-cache`; exact versions and lockfile in `web/`. Initial default-cache attempt failed because `/root/.npm` is read-only. |
| `npm run typecheck` | Passed, also invoked by each production build. TypeScript strict mode. |
| `npm run build` | Passed. Vite exports to root `dist/` with relative base. Generator then verifies the ABI source bytes/hashes and creates the complete manifest. A 500 kB chunk advisory remains for the ~532 kB main JS bundle. |
| `npm run verify` | Passed. Identifiers, complete contract set, unchanged network/add-chain data, both canonical Keccak ABI hashes, every asset SHA-256, relative paths and bounds verified. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/root/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome npm test` (from `web/`) | 23 checks passed on Chromium 154.0.8037.0. Production export served under `/preview/`, mocked RPC/browser-wallet responses, no broadcasts. See `evidence/interaction-results.json`. |
| Accessibility scan | axe-core WCAG 2 A/AA, 2.1 AA, 2.2 AA tags: 0 violations, 28 passing rules in the connected fixture. This is not a claim of complete accessibility conformance. |
| Live read-only verification | All three configured public RPCs returned chain 11155111, nonempty token/lottery code (1,722 / 4,134 bytes), the correct token pointer, and deployment block 11,794,808. At the recorded read, head was 11,794,917 and round was 0. See `evidence/live-rpc.json`. |
| Browser tool inspection | Production preview opened successfully. Desktop/mobile screenshots inspected; current round, zero pot and empty winner history loaded from actual RPC. Browser console had 0 errors/warnings and all observed static resources returned 200. |
| Scope, integrity and size | Final artifact audit recorded separately in `evidence/submission-size.json`. No submodule, vendored registry, dependency archive, source map, or node_modules in delivered files. |
| Git staging / commit | **Blocked by environment.** `git add -- web dist docs` exited 128: `.git/index.lock: Read-only file system`. Source/export/evidence remain in the working tree for the submission service; no worker commit exists. |

Initial validation failures were repaired and rerun: optional event ABI narrowing in typecheck, a mock fixture's eager bigint/address arithmetic, browser executable selection, an axe context setup issue, hidden custom revert reason, and recent-history overlap. A command inadvertently run from the repository root failed to find a package manifest and made no root changes; subsequent commands ran in `web/`.

## Interaction coverage

The 23 grouped checks exercise disconnected reads/disabled actions; wallet connection; exact approval target and amount; purchase enabled only after approval receipt; actual mined round from `Bought`; balance/allowance refresh; zero/over-limit/fractional/exponential/negative/empty counts; insufficient balance; wallet rejection/retry; simulation revert with no signature; settlement and duplicate-settlement guard; expired-round lookup/refund/duplicate-refund guard; claim/zero-claim guard; future-round validation and focus; wrong network with exact add-chain parameters and a second switch; account removal; missing code; RPC chain mismatch; wrong token pointer; RPC failure/recovery; corrupted ABI; missing wallet; strict draw-block boundary and inclusive +256/expiry +257; reverted receipts; stale state; chunked event scanning/deduplication; recent-block re-query; responsive widths, keyboard approval, reduced motion, and axe.

No backend or test switch exists in the production app. The fixture routes public RPC requests only inside Playwright and injects a mock provider. Tests inspect encoded transaction calls and receipts using the actual exported ABIs. These UI/RPC mocks do not execute EVM bytecode or prove lottery accounting/randomness correctness.

## Better Interface review

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility — Checked | Native links/buttons/forms/table/disclosure, labels, semantic outline, skip link, persistent alert/status, invalid field focus, disabled financial controls; keyboard input-to-approval path and visible focus screenshot; axe 0 violations. | No screen-reader session, physical touch device, or full manual focus walk of every possible state. |
| Layout — Checked | Source/DOM order reviewed; screenshots at 1440, 820, 390, 320 CSS px; no page overflow at those widths; 200% text enlargement at desktop also reflows. | Text enlargement is not browser-native 200% zoom. No translated or RTL variant is claimed; the app is English-only. |
| Writing — Checked | Consistent DRAW units, numbered approve/buy steps, mined-round confirmation, separate refund-credit/claim language, empty/partial/error history, recoverable RPC/wallet errors, explicit test-token/randomness disclosure. | Provider-specific errors beyond the mocked cases may vary. |
| Typography — Checked | Local font loads confirmed for both families; tabular changing numbers, readable input sizes, responsive heading wrapping, full deployment IDs in expandable details. | Font rendering outside tested Chromium/platform not verified. |
| Colors — Checked | Shared role tokens reviewed; five actual foreground/background pairs measured; lowest tested text pair 4.68:1 (ticket supporting copy); axe connected-state contrast checks passed. | No dark theme exists. Not every hover/disabled/focus adjacency was manually measured; disabled controls are visibly inactive. |
| UI — Checked | Normal, disabled, pending, success, rejection, simulation failure, RPC failure, empty and populated event states; flat panels, coherent border/radius treatments, reduced-motion transition duration 0 seconds. | No custom dialogs, complex animation, theme switch or carousel: not applicable. No animation-panel slow-motion review. |

### Findings, fixes, and rechecks

| Severity / source | Evidence and impact | Correction and recheck |
| --- | --- | --- |
| Medium — `web/src/lottery.ts:20` | Mocked `HashUnavailable` simulation displayed only “contract function settle reverted,” hiding the useful reason. | Extract the decoded custom error from viem's cause chain and provide retry guidance. Simulation test now verifies `HashUnavailable` and no `eth_sendTransaction`. |
| Medium — `web/src/lottery.ts:123` | Source review found that a normally advancing head could skip the intended recent-block rescan. | After reaching the head, rewind the cursor 12 blocks. Production interaction test advances the head and asserts overlapping queries without duplicate winners. Deep reorgs remain a documented reload case. |
| Low — `web/src/styles.css:200` | Initial 390 px screenshot wrapped the brand caption because the wallet navigation competed for inline space. | Keep the brand from shrinking and use a wallet column on mobile, then a full row at 320 px. Final screenshots rechecked. |
| Low — `web/src/App.tsx:155` | Hiding a line break on mobile joined two introductory sentences without a space. | Explicit inter-sentence whitespace; final 390/320 px screenshots show normal spacing. |
| Low — `web/src/styles.css:1` | Initial font CSS emitted unnecessary WOFF fallbacks alongside WOFF2. | Use six explicit local WOFF2 faces. Both fonts load; export is smaller and all required font licenses remain. |
| Medium — `web/src/App.tsx:160` / shared status styling | Final source review found empty live regions were hidden with `display: none`, which could prevent announcements when text arrives. | Leave the stable empty regions in normal flow (they have zero content height); remove that hiding rule. Rebuilt and reran the production suite. Screen-reader behavior remains unverified. |

### Evidence files

- `mock-1440.png`, `mock-820.png`, `mock-390.png`, `mock-320.png`: final production UI with clearly identified mocked balances/events.
- `keyboard-focus.png`: focused approval action during a keyboard path.
- `live-desktop.png`, `live-mobile.png`, `live-snapshot.yml`: read-only public-RPC UI, no wallet connected.
- `browser-console.txt`, `browser-resources.txt`, `browser-contrast.txt`: browser tool observations.
- `interaction-results.json`, `live-rpc.json`, `submission-size.json`: machine-readable local evidence.
- `build.txt`: captured final build/typecheck/manifest verification output. The byte audit uses a temporary incremental Git bundle against the supplied base commit, excluding the report itself with a 4 KiB reserve; it does not alter workspace Git metadata or create a workspace commit.

## Remaining limits and completion

Implementation and required local build/typecheck/browser/interaction validation are complete. The requested Git commit is blocked by read-only Git metadata. The root design-document path was resolved within the explicit write budget as described above.

No real-wallet signing, funded purchase, live settlement/refund/claim, swap, or deployment was performed. Transaction replacement/cancellation and receipt-timeout branches are implemented and source-reviewed but were not driven end to end by the mock suite. Browser-wallet fallback is implemented; direct extension UX and every RPC failover combination were not separately tested. Actual chain reorgs were not induced. History may be partial while a long scan runs and is not finality-guaranteed. Browser/native-device/screen-reader limits are listed per domain above.

IPFS pinning, named-site checks, fixed-CID checks, and publication are future control-plane tasks. Published URLs/CIDs are not prerequisites for this worker delivery. Worker evidence must not be represented as those publication checks.

Design/documentation attribution and pinned versions are retained in `docs/DESIGN.md`; font licenses are included in source, documentation, and export.
