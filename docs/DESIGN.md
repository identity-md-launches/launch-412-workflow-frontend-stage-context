# DRAW design

## Overview

DRAW is a small Sepolia lottery experiment. The implemented design uses warm paper surfaces, dark ink, large block counts, and a peach ticket panel. It keeps the live pot and entry controls together, followed by settlement, claims, and winner history. This visual direction was inferred for this assignment, not supplied as an approved brand system.

The source of truth is `web/src/styles.css`; page patterns and the `Mark` SVG are in `web/src/App.tsx`. This document is under `docs/` because the assignment's overriding path budget prohibits the otherwise requested repository-root `DESIGN.md`.

## Colors

| CSS token | Value | Use |
| --- | --- | --- |
| `--bg-page` | `#f4f1e9` | Paper background |
| `--bg-surface` | `#fcfaf5` | Pot panel, fields, transaction status |
| `--bg-soft` | `#ebe8df` | Round details and empty history |
| `--text` | `#242720` | Main copy and filled action background |
| `--muted` | `#5b6055` | Supporting labels and copy |
| `--line` | `#d5d5c8` | Structural separators |
| `--control-border` | `#7d8173` | Available controls |
| `--accent` | `#efaa88` | Ticket panel |
| `--accent-soft` | `#f7c8ad` | Ticket quantity field |
| `--error-text` / `--error-bg` | `#8b2e19` / `#fff0e9` | Persistent errors |
| `--focus` | `#374fc9` | Keyboard outline |

The ticket's small text uses `#454a3e`, ticket dividers `#926d52`, and outlined ticket actions `#685540`. Filled buttons hover to `#414639`. These local values are defined in the same CSS file. There is one light theme. Color accompanies labels; it never carries transaction status by itself.

Measured rendered contrast: main text/page 13.42:1, muted text/ivory panel 6.20:1, ticket supporting text/peach 4.68:1, ticket heading/peach 7.77:1, filled button label/background 14.52:1. See `docs/evidence/browser-contrast.txt`. These are identified opaque pairs, not a claim that every possible state was manually measured. Axe's tested connected state had no WCAG A/AA violations.

## Typography

Local WOFF2 subsets come from pinned `@fontsource/dm-sans` and `@fontsource/space-grotesk`, each at 400, 500, and 700 normal weights. Font files are emitted in `dist/assets/`, with OFL licenses in `dist/licenses/`. Both loaded families were checked in Chromium. Sans-serif system fallbacks remain available; `font-display: swap` permits immediate text rendering.

DM Sans carries body copy and controls; Space Grotesk (`--display`) carries headings, logo, pot, and counters. Default body is 16 px with 1.55 line-height. `--text-small` is 13 px, `--text-label` 12 px, `--text-heading` 24 px. Dense supporting text is 12–13 px; tiny uppercase stub and header metadata is decorative/supporting, never an input. Inputs are at least 16 px. The hero scales from 2.8 to 4.5 rem (a separate mobile clamp starts at 2.6 rem), with 1.02 line-height and negative tracking. Section headings are generally 22–24 px; counters 40–43 px. Headings use 500 weight. Body and controls use 400/500, emphasis 700.

Changing numbers use tabular figures. Long IDs and token quantities can wrap; abbreviated wallet links expose full addresses in their accessible names and explorer destinations. The connected address is also available in expanded deployment details. Headings balance wrapping and paragraphs use `text-wrap: pretty`; expanded explanatory copy is capped at 75 characters. Useful text remains selectable.

## Layout

`.page-width` caps content at 1160 px with 40 px side margins on wide screens. Primary grids use a 1.48:1 ratio and 24 px gap. The 60 rem breakpoint uses 24 px outer margins, 20 px gaps, a 1.2:1 ratio, and stacks ticket action buttons. At 45 rem, outer margins become 20 px and the main grids stack into one column. Navigation uses a compact wallet column; the three-step explanation becomes stacked rows. At 23 rem, margins are 16 px, the header and lookup controls wrap, and wallet metrics use two columns.

Spacing typically uses 8/12/16/20/24/28/32 px, with larger hero separation. Related labels sit close to their values; major groups have more space and occasional thin rules. Page reading order matches the DOM at every width. Controls remain in normal document flow. Browser inspections covered 1440, 820, 390, and 320 CSS pixels with no horizontal page overflow, plus 200% text enlargement. Native browser zoom and physical mobile devices were not tested.

## Elevation & Depth

The interface is flat: no shadows, floating panels, or modal layers. Ivory, paper, peach, and soft-gray surfaces establish grouping. Borders define fields and separators rather than simulated elevation. Only the keyboard skip link has an elevated stacking order. There are no page entrance animations.

## Shapes

Main panels use `--radius: 16px`; inputs/buttons and round detail panels use 8–9 px. Alerts and empty states use 10 px; the status pill uses a fully rounded 30 px radius. The ticket stub has a dashed top rule and a decorative barcode made from text. The reusable mark combines three outlined squares and a filled circle. Its standalone favicon is `web/public/mark.svg`.

## Components

These are source/CSS patterns, not a separate exported component library:

- `.button.dark`: filled emphasis for connecting, switching, or the currently available purchase step. `.button.outline`: secondary actions and unmet purchase steps. Native disabled state, visible explanation nearby, pending labels, 46 px desktop targets; header actions remain at least 40 px on mobile.
- `.text-button`: underlined tertiary controls such as refresh and disconnect. Links retain standard navigation and browser behavior.
- `.stepper`: labeled numeric-text input, explicit plus/minus buttons, and validation hint. Native button keyboard behavior; invalid inputs have an outline and `aria-invalid`.
- `.round-card`, `.countdowns`, `.wallet-strip`: stable numeric values with clear units and separate loading placeholders. Data freshness gates signing.
- `.round-lookup` and `.round-detail`: form to choose any existing round, status, deadline, buyer eligibility, and refund explanation. Validation focuses the field.
- `.alert` and `.transaction-status`: persistent error/status regions, recovery controls, and explorer links. Empty status containers stay mounted for announcements.
- Winner table: semantic headers and caption, linked wallet/transaction values, pagination, and separate empty/partial/error states. Zero-address settlements are filtered.
- Native `details/summary`: optional experiment and deployment information without a custom modal or focus trap.

`:focus-visible` uses a 3 px outline with 4 px offset. Forced-colors mode uses `Highlight`. Keyboard entry/approval and focused screenshots were checked. Only hover-capable devices get hover effects. Optional button color/press transitions are 120 ms, and pressed scale is 0.96; reduced motion removes them. No autoplay or motion-dependent information exists.

## Do's and Don'ts

- Start extensions with `.page-width`, existing type roles, and shared color tokens. Keep new content aligned with the current grids.
- Use the filled action style to identify the next available step; keep secondary actions outlined. Keep unavailable financial actions disabled and explain prerequisites.
- Keep DRAW amounts exact in logic and read deployment data from the runtime manifest. Always show the actual action and units before a signature.
- Reuse native forms, tables, links, and disclosure controls. Preserve keyboard access and persistent status messages.
- Do not invent another theme, add floating overlays, fetch remote font assets, or use a decorative value as real chain data.

Design guidance attribution: Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method: Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The supplied adapted guide was read locally; no new upstream design requirements were imported.
