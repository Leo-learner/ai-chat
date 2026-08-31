# AI Dialogue selected UI — design QA

Date: 2026-08-29
Scope: server chat-only web UI; no provider, API, persistence, or account behavior changes.

## Source and target

- Source: approved dark AI Dialogue mock `exec-32942cbc-d008-4f3f-b949-1475b7a6a23c.png`.
- Target: production branch `server/aichatupdated-20260628`.
- Required variants: dark and light, same layout and component proportions.

## Visual comparison

Compared the approved source and browser-rendered 1482 × 1061 desktop screenshots in one review pass.

- Shell: 96 px icon rail, 98 px header, full-width alternating message bands.
- Reading axis: avatar x=239 px and content x=335 px, matching the source composition.
- Message spacing: compact 30 px band padding at the reference viewport; no bubble styling.
- Composer: x=326 px, y=921 px, 926 × 80 px, with a small in-field send action.
- Palette: matte charcoal dark mode; warm neutral light mode; no gradient or glow.
- Light and dark themes use identical geometry.

## Functional and responsive QA

Passed in an isolated local account and database with a stubbed streaming provider:

- login and empty state
- open, close, search, and keyboard-open conversation history
- create and rename conversation
- draft persistence across reload
- Enter send and Shift+Enter line break
- streaming response, stop generation, provider error recovery, regenerate
- message actions and code copy
- settings validation, light/dark switching, theme persistence
- 64-message conversation, load older messages, return to latest
- Markdown headings, lists, blockquote, seven-column table, long code line
- 390 × 844 mobile viewport with no page-level horizontal overflow
- 1482 × 1061 desktop viewport with no page-level horizontal overflow
- focus return, focus trap, accessible labels, reduced-motion rule
- console errors/warnings: none

Contrast ratios:

- dark primary text: 11.95:1
- dark muted text: 6.97:1
- light primary text: 12.58:1
- light muted text: 5.12:1

Automated checks:

- `npm run check`: passed
- `npm run build`: passed
- `npm run smoke:startup`: passed
- local static asset and icon responses: HTTP 200

## Findings

- P0: none
- P1: none
- P2: none after correcting legacy positioning, mobile hidden-control overrides, and table/code overflow.

final result: passed
