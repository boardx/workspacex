# Reference-aligned Board editor shell

User reference: `Codex 图像 2026年9月27日 15_09_54.png`; direct adhoc design/implementation authorization. Supersedes the three permanent bottom rows in `928a3f698` / integrated `403414f5e`.

- Header: one quiet, approximately 60px row. WorkspaceX identity, Board name/menu, Undo/Redo and honest cloud sync state on the left; real collaborator avatars, access-aware sharing, presentation and overflow on the right. Never invent collaborator photos or a successful save/share state.
- Upper-right viewport control: current zoom menu and Fit; secondary zoom actions remain reachable without adding a second bottom row.
- Bottom dock: a single icon row with Select, Hand, Sticky, Text, Shape, Connector, Draw, Image and More. Existing Panel/content/AI actions remain behind the proper menu or functional extension. Keyboard tool shortcuts stay unchanged. Pointer targets are at least 44px; visible icons and restrained separators provide the hierarchy.
- Sticky palette: opens upward from the Sticky tool and edits only the defaults for future sticky creation. It uses the canonical sticky color presets and supported shapes. Selected-object color changes remain in the contextual toolbar and never overwrite the creation defaults.
- Selection: compact icon actions above the object's bounds, falling back around viewport edges/visible chrome. Multi-selection layout follows the same positioning model rather than a permanent bottom row.
- Read-only and offline mutation guards remain; all buttons have labels/tooltips and focus states. Reduced-motion preference disables decorative transitions. Reuse semantic design tokens, current font and API/operation paths.

Main-session visual acceptance: compare real screenshots at 1024, 1280 and 1440 against the reference, verify no vertical sync label or bottom toolbar stack, inspect contextual toolbar above selection, and exercise sticky palette color/shape creation plus Undo, zoom, sharing/presentation. Unit/static checks do not constitute visual signoff or a 9/10 score.

## Candidate verification and integration notes

- Focused unit suite: 69 assertions across 9 files passed; final contextual icon/readonly follow-up: 21 assertions passed. ESLint has no errors (the editor retains its two pre-existing hook-dependency warnings).
- `pnpm --filter web exec playwright test --config=playwright.board-compact-chrome.config.ts --list` collects the real-stack visual scenario. **Not executed by this worker.** Main session sets `WHITEBOARD_WEB_URL` and `WHITEBOARD_API_URL` to its isolated stack and runs the same command without `--list`; it generates 1024/1280/1440 screenshots of multi-selection and selected-note palette. No service is started by this configuration.
- Toolbar Sticky now selects the creation tool; click the canvas to place the new note. This avoids creating an unintended note while choosing a default color. `N`, double-click and continuous Tab retain their immediate creation paths. Older tests that click Sticky and immediately fill text must perform the canvas placement step. Panel is reached through More; import through the Board title menu; secondary zoom actions through the zoom menu.
- Multi-selection keeps the actual AI Organize control on its floating toolbar so proposal/confirm remains two actions. With fewer selections its existing options are inside More. Do not substitute a canned proposal for real-model acceptance.
- The Fabric visual token/projection change is a parallel commit, intentionally absent here. Preserve current root fixes when integrating the dense editor/live-board files. No database, provider, API authorization or model implementation changed.
