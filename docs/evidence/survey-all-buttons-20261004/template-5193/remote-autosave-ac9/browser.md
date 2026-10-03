# Exact ac9 browser acceptance

Source: ac9fa46fbe54d41f6aa5be03c8ba707e152d3f2a; web 25707, compatible Survey API 24704 (API baseline 814; see preview-runtime.md). Synthetic Survey 93750492-a585-4c08-9b01-ceb66960c2fd created through the built-in team health template UI.

1. Added multiline question 21 through design UI: automatically showed one uncovered-report design issue, then questions saved.
2. Opened More → design report template. Seven sections bound. Changed report title: after subsequent observation it remained “有未保存修改” with enabled Save. No automatic save. Screenshot ordinary-edit-unsaved.png. Explicit Save succeeded.
3. Clicked 不使用报告模板: zero sections, design check passed, undo appeared. Clicked undo: seven sections and coverage error restored, previous edited title retained. Screenshot undo-restored.png.
4. Clicked clear again; without clicking Save, observed saved timestamp 04:15:36 and disabled Save. Reloaded: zero sections, check passed, undo absent, title reset to questionnaire name. Screenshot clear-persisted.png.

These screenshots belong to ac9; original b4bc evidence is separate. This run does not assert published-snapshot preservation, exact debounce cancellation race, new-template replacement confirmation, complete tags preservation, or all 558 matrix cases.
