# Survey App Shell — Design QA

## Reference

- Source: user-provided Research Studio screenshot.
- Core requirement: preserve the global icon rail and the module-level left navigation while replacing only the right content area.

## Prototype under test

- `/studio/survey`
- `/studio/survey/sv-1?step=design`
- `/studio/survey/new?step=design&mode=module&module=profile`
- `/studio/survey/templates/tpl-team-health`

## Visual comparison

| Criterion | Result | Evidence |
| --- | --- | --- |
| Global navigation rail remains visible | Pass | `shell-rail` is present on list and editor routes. |
| Secondary Survey navigation remains visible | Pass | `shell-left-panel` and `survey-section-nav` are present on list and editor routes. |
| Only right content changes | Pass | List content begins after the two left columns; editors render in the same right content region. |
| Three Survey primary entries remain available | Pass | 问卷列表、问卷模块、报告模块 are always rendered. |
| Entry state follows the current route | Pass | Survey editor activates 问卷列表; module editor activates 问卷模块; report editor activates 报告模块. |
| No horizontal overflow at desktop viewport | Pass | Page width equals the 1280 px viewport. |

## Final result

Pass. The Survey experience now follows the same shell hierarchy as the supplied Research Studio reference without duplicating its own full-screen header or sidebar.
