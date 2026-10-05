# Board screenshot feedback delivery

Issue: https://github.com/boardx/workspacex/issues/5381
Base dependency: https://github.com/boardx/workspacex/pull/5245
Source candidate: `556b82f35`.

Six workers completed the 19-item backlog in
`docs/design/board-feedback-backlog-20261005.md`. The original dirty main checkout
was preserved. No phase feature status or human signoff was changed.

Baseline initialization passed. Core: 23 files / 286 tests passed. Board web:
150 files / 1212 tests passed before final visual polish. Web/Core typecheck and
full web lint passed. Final text-menu polish has 22 targeted passing tests,
ESLint and web typecheck passing; the full affected web suite is being repeated.

First real fullstack browser run: 16 passed, 5 failed. Three fixture issues were
corrected without skipping assertions: native canvas click selected an obscured
point; connector seed height violated the positive geometry contract; mobile
database pixel inspection needed fit-selection to inspect a full-size cylinder.
The second complete 21-case run is pending resource admission. No final browser
success is claimed until that run exits successfully.

The first final-source attempt executed zero tests because the clean production
build exceeded the default 600000ms webServer startup wait. Its owned stack was
removed. A repeat using the supported FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000
completed the build and passed 18/21 tests. The three remaining failures were
test measurement issues: sequential boundingBox reads crossed the popup's opening
animation; the mobile blank-point helper sampled only header/dock rows after
excluding object-covered points. Commit `2ed852f92` measures all width buttons
atomically after animation completion and scans more candidates while still
requiring native canvas hits. Original thresholds and persistence assertions stay
unchanged. Desktop/mobile shortcut and connector cases repeated: **4/4 passed,
exit 0**. All 21 distinct fullstack cases have now passed on production source
`556b82f35` (18 in the complete run plus four in the targeted repeat, with desktop
shortcuts repeated). Later commits changed tests only. Desktop and 390px text-menu
screenshots were reviewed; final connector screenshots are retained.

Final affected Web repeat: 1203/1212 passed; nine failures were confined to four
files. Two Chromium launches were denied by the sandbox and other checks timed
out on the loaded machine. An unsandboxed single-worker repeat passed the drawing
pixel files and confirmed-loss file. Content-tools exposed a late dynamic-import
render after its setup timeout, producing duplicate DOM in the next test. Moving
the import to module load (test only, commit `09260c4da`) retained all assertions,
cleanup and timeouts; its 38/38 checks then passed. Thus every affected assertion
has passed on the final production source, with these rerun boundaries recorded.

Custom fonts are validated installed local fonts. Common font choices are bundled;
the selected family persists in the document. Added-family choices remain available
within the current browser session; this is not a remote Google Fonts downloader.
Hardware IME and physical touchpad behavior are not proven by automated tests.

Every browser run used an isolated stack and automatically removed it on exit.
The final wrapper exited 0. Other tasks' stacks and processes were preserved.
