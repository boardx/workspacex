# AIDT supplementary Design acceptance

QA-only runner for the separately authorized two Design tasks. It does not start services,
change roles or wallets, use SQL, substitute model responses, or reset the earlier native/Design budgets.
All student inputs and feedback are explicitly synthetic; these checks do not establish research findings
or classroom teaching quality.

The two generation tasks use saved textual HMW/description-sheet/question history. S4's real uploaded
synthetic PNGs and PDF exports are checked by A6 separately. This runner does not upload a Design
reference image or establish that a provider has interpreted an image; vision input remains untested.

Run from the repository root with Node 22 and the existing dependencies. Only the three private paths
below are environment variables, and all must be absolute paths outside this repository. Never copy their
contents into an issue, terminal transcript or evidence export.

```bash
export AIDT_DESIGN_RUNTIME_FIXTURE=/PRIVATE/stack04/runtime-private.json
export AIDT_DESIGN_STATE=/PRIVATE/supplement-design-state.json
export AIDT_DESIGN_SUPPLEMENT_LEDGER=/PRIVATE/supplement-design-ledger.json
pnpm exec tsx apps/web/scripts/aidt-design-acceptance.mjs --self-check
node --test apps/web/scripts/lib/aidt-design-supplement-ledger.test.mjs
```

The fixture must supply the existing `baseURL`, `apiOrigin`, `fundedAdminEmail`, and
`fundedAdminPassword` fields from the stack owner. The browser signs in normally. Both A6's group
and the new Design must belong to that same actual technical actor; this is not a student permissions test.
The browser uses `/usr/bin/chromium` unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is specified.

1. A6 finishes and saves S3 HMW, S4 selected description sheet, and confirmed S5 question. A5 runs
   `--phase prepare --project REAL_NEW_GROUP --out /tmp/design-prepare` with the script above.
   This checks actual project access and saved inputs, selects the current saved S3/S4 source revisions
   through the existing UI when needed, and creates/links one empty owner Design. No generation occurs.
2. Only after root opens the V1 task window, run `--phase v1 --allow-task v1 --project REAL_NEW_GROUP
   --out /tmp/design-v1`. Exactly one `appendProjectChat` POST uses `maxScreens:1`. The runner requires
   `reply.source=model`, one actual newly stored native version with model source, single-screen content
   and a visible static marker. It saves the actual version JSON (and actual HTML bytes when the native
   version contains HTML), captures the real UI, selects the version with the native picker, saves S5,
   and freezes/saves its exact question and version in S6.
3. A6 uses that group for its S6 Agent task, then explicitly saves return-to-S2 reflection. A5 waits for
   exclusive ownership before V2. Only after root opens V2, run `--phase v2 --allow-task v2 --project
   REAL_NEW_GROUP --out /tmp/design-v2`. It preserves the previous S6 revision, saves a new explicit
   synthetic return-to-S5 revision, and changes the current S5 question. Both S6 and the historical
   return-to-S5 Design handoff must still contain the old frozen question, excluding the new S5 head.
   One generation POST produces V2. Its native ID and content hash must differ from V1 and its sequence
   must increase. The student selects the actual iteration version, confirms its old-version/feedback
   relation, saves/reloads it, and reads the previous return-to-S2 revision unchanged. A6 runs SUM afterward.

Each command writes a phase result JSON in its output directory. The state file holds the actual Design,
version IDs, exact source revisions, frozen snapshot, and generation metadata for the following command.
A process lock prevents concurrent phase owners. The separate supplement ledger reserves each business
task before its sole request; failed, interrupted or uncertain reservations are retained and cannot retry.
It never calls `/variants`, intake questions, auto-start generation, or a second POST to recover a failure.
If a check fails, preserve the existing task/state and report it to root rather than running it again.

Two business requests can entail more physical model requests. Task timestamps, prompt hashes,
source/version metadata and outcomes are recorded; physical starts, tokens, settlement and released
holds remain `pending-stack-owner-audit` until A1 independently reconciles the actual accounting tables.
Do not describe the static markers, generated page, version metadata, PNG or software assertions as
real-user feedback, proved usability, or broad generation-quality validation.
