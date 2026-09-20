# Restore survey template libraries — #3756

The user confirmed restoring survey list, question templates, report templates and implementing create/edit/save/reuse after the previous delivery removed these entrances. This is a bounded correction to the approved Survey design; no further design permission is needed.

## Behavior

Three permanent, real-session navigation entries. Question templates and report templates are independent owner-scoped persisted resources. Template editors reuse the existing question/block editors. Saving must survive reload, version conflicts preserve edits, deletion requires confirmation. No simulated counts or successful mock writes.

Question templates create independent surveys without answers/publication/history. A current survey can be saved as either template kind. Applying a question template replaces questions and its companion report only after confirmation; published questions remain locked. Applying a report template preserves questions and explicitly maps source question references to target questions. Existing reports remain snapshots until regenerated. Source templates never change when their copies are edited.

## Implementation / verification

- New typed template contract and owner/tenant storage, reusing the personal survey repository permission boundary.
- Restore navigation and actual list/detail routes, including legacy query aliases.
- Shared editors, template save/use actions, question mapping and copy isolation.
- Contract/PG/HTTP tests for CRUD, concurrency, ownership and separation from survey records; UI tests for navigation, failed saves and binding preservation.
- Real browser: create template → save/reload → create independent survey → apply mapped report template → save/reload.
- Migration replay, lint/typecheck, independent review, PR and CI gate.

AI suggestions and project-shared templates remain outside this correction. Do not remove these three navigation entries when another capability remains incomplete.
