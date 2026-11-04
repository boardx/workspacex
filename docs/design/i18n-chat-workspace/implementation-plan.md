# Canonical Chat Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Work is owned inline by this worker; independent reviewers remain read-only.

**Goal:** Complete canonicalChat UI and its reachableoverlays in zh-CN/en without altering content or execution.

**Architecture:** Keep stablev2layout/controller identity and existingI18nProvider. Use typed splitdisplaynamespaces and semanticerror rendering. Extract the oversized controller's pure view tree, preserving hooks/memoizedcontexts/handlers.

**Tech Stack:** Next14/React/TypeScript, existingprovider,Vitest+RTL,PlaywrightstandardisolatedAPI/Postgres/loopbacklane.

**Spec:** [design.md](design.md) and issue6200; globalphaseauthority issue6133BODY.

## Global Constraints

- zh-CN/en only; rawuser/modelcontent and IDs/enums/URLs/APIpayloads unchanged.
- Locale switches do not restart requests, remountthreads or rewrite existingdrafts.
- Authored welcome card explicitlyprefills locale-specificeditablegoal only on click; noautosend or executionprompt translation.
- Canonicalcontroller<2000lines throughpureviewextraction; no unrelatedstate-machine changes.
- Firstphase sharedASR/errorcopy/studio/report components are not edited competitively.
- Heavytests/build/browser/push serialized; actualcanonical configreachability mandatory; normalhooks/deny/Escape/once/timeout preserved.

## Review Focus

- Rapidlocale/threadswithactiveSSE: stablecurrentthread/run/messageidentity and nooldcallback overwrite.
- Partiallytyped/multibyte/rawHan content: exactdraft/title/file/modeltext and selection retained.
- Permissionloading/denial/inflightapprove: nofalsewritegrant or duplicatePOST; overlayfocus/Escape semantics unchanged.
- Activevoice/upload/realtime: noaccidental send, duplicateupload/restart or recycledattachmentidentity.
- Suggestions and callbackerrors: explicitauthoredprefill language; stabletemplateIDs; raw/generatedinstructions remain untouched.

### Task 1: Shell, welcome and authoredprefill language

**Files:** modifythread-list-shell.tsx,chat-task-workbench-empty-state.tsx,copilotkit-v2-shell.tsx; createpuretask-template definitions/copyhelpers andchat-shell namespace; tests/ui/i18n-chat-entry.test.tsx.
**Interfaces:** existingI18nProvider; localizedTaskTemplates(locale):readonlyTaskTemplate[] keepscanonicalzhreference andIDs/tones; explicitEnglishauthoredgoals. Existingexport re-exportedcompatibly.
- [x] WriteproviderEN andlocalecontinuity semantictests(defaultzh/rawcustomlabel/Englishdefault/chips/briefing/noautoaction/templateID/prefill).
- [x] RunoneworkerRED beforeprodedit andpreserveoutput.
- [x] Implementonlytypeddisplaychanges; unknownrawcontent not translated.
- [x] Runnewandadjacentshell/template tests; commitworkinggroup.

### Task 2: Controller/view boundary and composer/capabilityoverlays

**Files:** copilotkit-v2-panel-body.tsx, newcopilotkit-v2-panel-view.tsx,chat-task-workbench-capability-picker.tsx,chat-composer-* anddisplayhelpers/namespace; existingvoice/attachment/permission UItests plusnewprovidercontinuitycases.
**Interfaces:** typedpureviewpropscarryexistingstate/handlers/contextvalues; controllermemoidentityunchanged; useI18n inviewonly, semanticdisplayreasonsinsteadlocale-dependentrequestcallbacks.
- [x] PinnewENlabel anddraft/caret/voice/upload/permission/no-remount REDcases.
- [x] RunactualRED inreservedshortwindow.
- [x] Extractpresentationtree andlocalizecomposer/pickers/attachment/voice/realtime chrome; preserveallwire values andgates.
- [x] Verifycontrollerlinebudgetandexistingcriticalvoice/HITL/runrestoration suites, commit.

### Task 3: Messages, tools, run/queue and actions

**Files:** assistant/user-message renderers,message-actions,toolrenderers,workbench/*,error/status displayhelpers,typedchat-interactions namespace.
- [x] AddsemanticEN/zhcontinuity plusrawmessage/code/toolargument/APIpayloadnegativecases.
- [x] RunRED beforeminimaldisplayimplementation.
- [x] Keepreason/enums stable, localizesemanticUIat render, neverregex usermessages or translatedexecutioninstructions.
- [x] Runadjacentapproval/queue/stream/reload tests, commit.

### Task 4: Inspector, settings, details, knowledge andpreviewoverlays

**Files:** chat-task-inspector,roster/material/artifact/attachmentpreview/dialog,knowledge/*actualrenderedexports andsharedownedchrome; chat-knowledge/detail namespace.
- [x] Finalizeactualexport/renderreachabilityrows beforecopyedits; inheritedlocalizedSharingnotduplicated. See task4-entry-audit.md; canonical shell, nested previews, feedback and gated edition ownership confirmed. This check records source reachability, not runtime acceptance.
- [x] Writeoverlayopen/close/reject/late-response/locale/rawpayload REDcases.
- [x] Implementdisplay-only allreachableoverlaystates; coordinateanysharedB4/B7underlyingwidgetfirst.
- [x] Runfocusedandadjacentsuites; updateinventoryonlywithactualevidence.

Task4 mechanical completion: BASE23db2c19460fde90709600669259349ad213f6ec→7fcd35346c933889b760b327bfdae8905567e2f5, exact76files532/532PASS150.15s; post-fix type90 0/16.415s and90lint0/5.796s. Original75 firstfailed514PASS13FAIL remains, no stitchedgreen. Task5 browser/CI/merge still pending.

### Task 5: Complete userjourney acceptance anddelivery

**Files:** registered e2e/i18n-chat-workspace.spec.ts inplaywright.chat-read.config.ts,coverageinventory,design/plan/evidence.
- [ ] Realpersonal/project/deniedseededactors:sidebar/create/search/pin/rename/menu, authoredcardprefill/noautosend/rawdraft,agentpicker/permissions/attachments,send/persistedreply,tools/HITL/queue,details/settings/materialpreview.
- [ ] Addnegativeerror/reload/active-runlocale checks; retainrawIDs/payloads andcanonicalexecutionproof.
- [ ] 375/1280screenshots foractualroutes/overlays; inspecteveryimage, notonlybounds.
- [ ] Runallrelevantwebchecks/type/lint andactualcanonicalconfigreachability; nofakefull-suite claim.
- [ ] ExactSHAindependentreview,normalpush,automaticPRCloses6200; ownfreshsource/candidateCItoactualmerge.
- [ ] Update6133BODY coverage/remaining andimmediatelycontinueB1/projecttabs/workflowperpriority; donotstopatonecomponent.

## Interface ledger

Pre-flight: Tasks 1→2 share typed locale messages and stable template IDs; render-only hooks stay outside request-effect dependencies. Tasks 2→3 share canonical run/message context; view extraction preserves controller ownership. Tasks 3→4 share semantic errors and raw content; no duplicate mutation or payload translation. Tasks 1–4→5 share route/overlay inventory; only executed evidence marks coverage. No conflicting interface found.

Task 1 evidence: provider RED5/5 3.13s; title continuity RED1/6; canonical shell RED1/1; semantic mutation errors RED5/5. Final eight-file focused/adjacent suite61/61 15.34s, web type3/3(2cached)36.396s, targeteslint0, actual reachability69configs/12live. Source/candidate/browser acceptance remains pending. Initial namespace insertion transform failure and unsupported matcher failure are retained separately and are not passes.
