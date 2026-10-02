# Template cancellation and subsequent creation — #5116

## Problem and change

During real survey button acceptance, selecting a template and cancelling creation left the following AI creation dialog's Next button persistently disabled despite a valid name. Reloading the real page restored it. The template-loading effect sets loading=true, but cleanup disables the active guard, so the old finally cannot clear the shared loading flag.

The effect now clears loading when the dialog closes or leaves template mode. Existing active guards continue to discard obsolete request completions. No contracts or creation permissions change.

Product b2b4ea43a93f8bbba141cd7a4aac7ab0541565a3; final tested production source bf10158da3858b8d0c7ff8da4b658b5c3f95ccf8. This independent branch starts at main75addf4923c2ca550e3f8e313a3d1563fcc61489 and excludes unmerged #5086/#5098/#5109 changes.

## Real browser chain

The same owned isolated stack was cleanly rebuilt at bf10158. Only the genuine local template-list request was temporarily paused through the browser's developer network capability, without changing response contents, page state, or database records. Each action used real form controls. This is controlled pending-network verification, not a claim about a naturally slow provider.

1. Paused the actual `surveys/templates?kind=question` request; DOM shows template loading and disabled Next (`fix5116-pending-before-cancel`). Clicked Cancel, reopened creation, filled a valid name, selected AI creation. Next is enabled and clicking it navigates to the real import page (`fix5116-cancel-reopen-ai`, `...-route.txt`). No AI proposal was generated or applied in this chain.
2. Started another paused template request and switched to AI creation, then blank creation. Next is enabled in both modes (`fix5116-switch-ai`, `fix5116-switch-blank`). Returning to template mode starts its current request; Next stays disabled while that current request is pending (`fix5116-new-template-request-pending.txt`).
3. Released actual requests, cleared interception, selected personal template CURRENT 自建保存入口验收模板 and clicked Next. The server created `9566c51c-5c38-46de-865a-8c5b79e4218c`, CURRENT 模板应用与切换复测5116, with all 9 template questions. Reload retains 9 (`fix5116-template-created-nine`, `...-reloaded-nine.txt`). This increased the owned workspace count from14 to15; templates stay8.

Browser raw interception initially rejected an untyped pattern and later rejected Fetch.disable. It was immediately corrected using explicit non-Document XHR patterns and cleared with supported Fetch.enable patterns=[]; no interception remains. All screenshots and DOM files were captured directly from the active tab.

## Verification and boundaries

- Corrected regression against old product: 3 failed / 13 passed, all three failures are real Next-enabled assertions (close/reopen AI, switching to blank, switching to AI).
- Initial close/reopen test mock lacked a second request and produced TypeError; this was corrected and the old implementation rerun. That mock error is not counted as valid RED.
- Final fixed UI regression: 19 passed across live library and existing creation dialog suites.
- Counterproof: two pending template requests; obsolete request completes first, current template dialog remains locked until its own request completes. This is independently asserted in the automated regression. Manual evidence only proves the current pending request remains disabled; it does not prove an obsolete callback's precise scheduling.
- Independent reviewer Accept exactbf10158, no P0/P1/P2; independently ran19 tests, non-incremental web typecheck and diff check. Reviewer did not perform browser actions.
- init --quick passed dependency/quick health only. Clean production build compiled/typechecked and generated124 pages; API/Web health200.
- Before rebuild all public survey tables backed up, SHA2569e5652e038c7b89c14405ee53e7cbdb1348cdbcd6c78113726c9c2c0a6bd1e93. Counts14workspaces/8templates/3attachments/1upload-session and11 real UI responses in the pagination fixture preserved. SQL/logs/credentials remain private, not committed.
- Full PR CI and all survey buttons remain unverified. Human instruction forbids merging.

## Evidence hashes

| File | SHA256 |
| --- | --- |
| `current-create-after-template-cancel-stuck.jpg` | `402803117bd48963e2b713cf9a6b79a8203cd1c32067bc1d2287c062a8615025` |
| `current-create-after-template-cancel-stuck.txt` | `7488ee1c08b7476aea37d857440edd0e148576aaaa4946e9fa01e9f2ee2cea4b` |
| `fix5116-pending-before-cancel.txt` | `908f9688fc7a488e0bcd279ce5ab7df7bb69a7a9b5b1d64da30bf95dbf2e855b` |
| `fix5116-cancel-reopen-ai.jpg` | `11a635d60f6cccc680909db2ec7febd295b06c2ab9ec27389ad75fd857a75c4a` |
| `fix5116-cancel-reopen-ai.txt` | `18596509aae7bb5b51e3074ce2b3e819be7edc505f39a0ce579fb34b7d13532a` |
| `fix5116-cancel-reopen-ai-route.txt` | `9e351f562b8d8d5bbaf36bf808624412cfb5d86ff386d79adf00d8ca25675b2c` |
| `fix5116-switch-ai.jpg` | `791ef4d7b8caeb1f5f1db18365c0cb9b5d48bce42f85cf5b90994c49f67802a9` |
| `fix5116-switch-ai.txt` | `cc929e1a6f6aee2552bac37ef67eef616cdd1cd21fbed77de956fbdd8e8d4a45` |
| `fix5116-switch-blank.jpg` | `15ed0c88c1e0ef9af223855a6dc83d415119d71f462b0d5f6d9d7ba9d6800a65` |
| `fix5116-switch-blank.txt` | `e285c074359228f257b8caf181e68fafbe6a6f0b9e591fe3b0d2c4933819d3f0` |
| `fix5116-new-template-request-pending.txt` | `e7e98240836c9d56307a27abeda245408a07df96fd568d37ea61cd0e0ca84207` |
| `fix5116-template-selected.txt` | `655fb6ca46651e8f0cb90529fef96c4570918c3774bb819f2a0e799037ceebcc` |
| `fix5116-template-created-nine.jpg` | `f0c6e197b8e67be053b68b7eeb7c936a38be2669b4f3a9e9b5d049ec0aab023a` |
| `fix5116-template-created-nine.txt` | `46d9b917c8f9b8b1a85f5c5478584adbdc1778a23dd6884e0c0a21341af90232` |
| `fix5116-template-reloaded-nine.txt` | `46d9b917c8f9b8b1a85f5c5478584adbdc1778a23dd6884e0c0a21341af90232` |
