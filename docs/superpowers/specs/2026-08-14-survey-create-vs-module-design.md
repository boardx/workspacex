# Survey creation intent vs question module editing

Issue: [#1224](https://github.com/boardx/workspacex/issues/1224)

## Goal

Separate two user intents that currently share `mode=module`:

1. Create a survey, optionally using a question module as its starting content.
2. Create or edit a reusable question module.

A created survey always uses the complete five-step survey workflow. A question module editor only edits reusable questions and never shows the workflow timeline.

## User-visible behavior

### Create a blank survey

- Entry: `问卷列表` → `新建问卷`.
- Destination: `/studio/survey/new?step=design`.
- The design step starts with an empty survey and offers `添加第一道题` and `从问卷模块选择`.
- The five-step workflow timeline is visible.
- The Survey secondary navigation keeps `问卷列表` active.

### Create a survey from a question module

- Entry: `问卷列表` → `从问卷模块新建`.
- Destination picker: `/studio/survey?tab=modules&intent=create-survey`.
- The picker heading and helper copy make it clear that the user is selecting a starting module for a new survey, not editing the module.
- Selecting module `<moduleId>` opens `/studio/survey/new?step=design&sourceModule=<moduleId>`.
- The new survey contains cloned questions from the selected module and shows the complete five-step workflow timeline.
- Changes to the new survey do not mutate the source module.
- The Survey secondary navigation keeps `问卷列表` active throughout this creation flow.

### Create or edit a question module

- Entry: `问卷模块` → `新建问卷模块` opens `/studio/survey/new?step=design&mode=module`.
- Entry: clicking an existing module opens `/studio/survey/module-<moduleId>?step=design&mode=module`.
- A new module starts with no questions.
- The module editor never shows the five-step workflow timeline.
- The Survey secondary navigation keeps `问卷模块` active.
- Returning goes to `/studio/survey?tab=modules`.

## Routing and state authority

Each fact has one authoritative URL field:

| Fact | Authority | Meaning |
| --- | --- | --- |
| Resource-library section | `tab` | `surveys`, `modules`, or `reports` |
| Picker purpose | `intent=create-survey` | The module collection is being used as a source picker for a new survey |
| Workflow kind | `mode=module` | The destination is a reusable question-module editor |
| Survey source | `sourceModule=<moduleId>` | Clone this module into a new survey |
| Workflow step | `step` | Active step of a full survey workflow |

`sourceModule` and `mode=module` are mutually exclusive. If both are supplied, module-editing mode wins and the source parameter is ignored so that a malformed URL cannot expose both interfaces at once.

The module identity used for module editing remains derived from the stable `module-<moduleId>` path. It is not repeated in another query parameter.

## Component changes

### Resource library

`SurveyResourceLibrary` derives a presentation mode from `tab` and `intent`:

- Normal module management: module cards edit modules and the primary action creates a module.
- Survey-source picker: module cards create a new survey from that module; module-management actions are replaced by picker-specific copy and a cancel/back action.

The source picker reuses the same module data and cards, but does not reuse their edit destination.

### Workflow page and model

The survey workflow page parses `sourceModule` separately from `mode` and passes it to `SurveyWorkflowShell`.

`SurveyWorkflowShell` initializes the model as follows:

- `moduleEditor=true`: empty new module or the module identified by the path; timeline hidden.
- `moduleEditor=false` with `sourceModule`: new survey identity and title; cloned module questions; timeline visible.
- `moduleEditor=false` without `sourceModule`: empty new survey when `surveyId=new`; existing survey data otherwise.

Question cloning must create new question and option arrays before editing so the source module remains unchanged.

### Empty design state

The empty-state heading and actions depend on workflow kind:

- Survey: `当前问卷还没有题目`; actions create a first question or open the survey-source picker.
- Module: `当前模块还没有题目`; actions create a first question or copy an existing module into the module editor.

This avoids describing a new survey as a module.

## Error and compatibility behavior

- Unknown `sourceModule` values produce an empty new survey rather than falling back to unrelated questions.
- Existing module edit URLs continue to work.
- Existing survey URLs and all five workflow steps continue to work.
- The legacy `tab=templates` compatibility mapping remains unchanged.
- Read-only mode hides all mutation actions in both empty states.

## Verification

Tests must fail against the current implementation and cover:

1. `从问卷模块新建` enters picker mode instead of ordinary module management.
2. A module card in picker mode routes to `new?step=design&sourceModule=<id>` without `mode=module`.
3. The same module card in management mode routes to the stable module editor with `mode=module`.
4. A survey created from a second module displays that module's questions and the five-step timeline.
5. A blank new survey has no questions and uses survey-specific empty copy.
6. A new module has no questions, uses module-specific empty copy, and hides the timeline.
7. A malformed URL containing both `sourceModule` and `mode=module` renders only the module editor.
8. Existing survey, module, report-module, layout, and search-reset tests remain green.

Run the targeted Survey UI tests, web typecheck, design lint, and `git diff --check`. Before PR handoff, run the trusted production/CI path that previously caught Survey prerender failures.

## Scope

Only Survey resource-library routing/copy, Survey workflow initialization/empty-state behavior, and their tests are in scope. Persistence, backend APIs, report generation, and unrelated AppShell navigation are out of scope.
