# Visual redesign report

Owner-approved operations-room redesign across every Klik Go surface, using Klik Go brand colours. Patterns are recreated in `packages/config` / `packages/ui` (not copied from any private reference).

## PRs

| PR | Branch | Scope |
|---|---|---|
| [#35](https://github.com/Klik-Go/delivery-services/pull/35) | `cursor/visual-redesign-tokens-f981` | R0 design system: role tokens, Inter + JetBrains Mono, CVA primitives, `/dev/ui`, `not-found` |
| [#36](https://github.com/Klik-Go/delivery-services/pull/36) | `cursor/visual-redesign-customer-f981` | R1 customer PWA + auth/public (masthead, bottom tabs, photo cards, sheets) |
| (this) | `cursor/visual-redesign-ops-f981` | R2–R4 rider/merchant SurfaceShell + admin DeskShell (index rail), SLA StatusMarks, mono rider figures |

Stack order: #35 → #36 → ops PR.

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

## Left for the owner

1. Merge stack bottom-up (#35 then #36 then ops); confirm CI green on each.
2. Supply merchant cover / dish photos when available (fallbacks are in place).
3. Optional later: ship `.dark`, merchant desk rail parity with admin, Filipino overflow pass on tab labels at 390px, Lighthouse after photos.
4. Confirm theme-color if browser chrome should switch from logo blue to masthead ink.
