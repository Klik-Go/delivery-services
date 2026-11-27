# Visual redesign report

Owner-approved operations-room redesign across every Klik Go surface, using Klik Go brand colours. Patterns are recreated in `packages/config` / `packages/ui` (not copied from any private reference).

**Status:** #35–#38 merged to `main`. Final PR #39 open; merge after CI.

## PRs

| PR | Branch | Base | Scope | CI |
|---|---|---|---|---|
| [#35](https://github.com/Klik-Go/delivery-services/pull/35) | `cursor/visual-redesign-tokens-f981` | `main` | R0 design system: role tokens, Inter + JetBrains Mono, CVA primitives, `/dev/ui`, `not-found` | Merged |
| [#36](https://github.com/Klik-Go/delivery-services/pull/36) | `cursor/visual-redesign-customer-f981` | `main` | R1 customer PWA + auth/public (masthead, bottom tabs, photo cards, sheets) | Merged |
| [#38](https://github.com/Klik-Go/delivery-services/pull/38) | `cursor/visual-redesign-ops-f981` | `main` | R2–R4 rider/merchant SurfaceShell + admin DeskShell (index rail), SLA StatusMarks, mono rider figures | Merged |
| [#39](https://github.com/Klik-Go/delivery-services/pull/39) | `cursor/visual-redesign-polish-f981` | ops | R5 polish: Filipino short labels, rider bottom tabs, legal/consent sheets, role-token sweep, photo fallbacks | Green |

Stack order: #35 → #36 → #38 → #39. Merge bottom-up.

## Defaults chosen (open decisions)

| Decision | Choice |
|---|---|
| Scope before pilot | Full redesign through admin (not only customer) |
| Dark mode | `.dark` role tokens defined in tokens.css; ship light-only |
| PWA `theme-color` | Keep logo blue `#228be6` |
| Customer desktop | Two-column home (feed + cart aside from `lg`) |
| Merchant desktop | Compact portal chrome for now; admin gets full desk rail |
| Tabular mono | JetBrains Mono (self-hosted `@fontsource/jetbrains-mono@5.3.0`) |
| Success green | `#16734A` / `#EAF8F0` (`certified`) |
| Photos for pilot | Designed `PhotoFallback` |

## Screenshots

- R0: `docs/screenshots/redesign-r0/` (UI kit + auth)
- R1: `docs/screenshots/redesign-r1/` (auth, partners, become-a-rider; home needs local DB)
- R5: `docs/screenshots/redesign-r5/` (legal, consent chrome, `/dev/ui`, fil tab labels when captured)

## Left for the owner

1. Merge final polish PR #39 after CI on `main` retarget.
2. Supply merchant cover / dish photos when available (fallbacks are in place).
3. Optional later: ship `.dark`, merchant desk rail parity with admin, denser desk density tweaks after live ops use.
4. Confirm theme-color if browser chrome should switch from logo blue to masthead ink.
5. Spot-check Filipino (`fil`) at 390px on customer tabs and admin rail after merge.
