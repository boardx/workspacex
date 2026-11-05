# General project overview i18n — #6258

Approved display-only scope: complete actual general-project overview at `/projects/[projectId]?tab=overview`, including onboarding, members, content counts/recent dates, brain summary/partial errors, workflow-board link, loading/empty/denied/error. Existing project UI/use cases/contracts remain authoritative; no new behavior or signoff status mutation.

Preserve general/workshop route distinction, real roles/access, raw titles/member names/unknown caller messages, stable filter keys, counts, href/query, original effect dependencies/cancellation and request multiplicity. Locale projects display from facts, never enters request dependencies or changes storage/domain state. Existing default ZH stays compatible. Destination content/settings/brain/workflow pages and workshop/creation flows are separate issues.

Baseline: accepted develop72a409bf712dca90e7012bfc01b5398c60bca343. Chat6252 queued head a9830b remains on its original branch, unmodified. This page requires only already accepted i18n provider/resources, not Chat-private helpers; no stack on unmerged Chat.

Source map: TabGeneralOverview; shared content index/category/date projections from project-content.tsx and owned failure formatter from project-resource-section.tsx. Refine shared display-only interfaces without translating keys, reformatting raw content or changing destination-page behavior. Keep original useMembers/useBrainSummary/index fetching/cancellation/dependencies; a raw-cause carrier is allowed only where render-time locale projection needs it, not a new request/error contract.

Acceptance: real provider RED→GREEN across populated/empty/loading/member+content+brain errors and reasoning partial success; same-DOM/current-locale/raw/request-count invariants; existing general-kind/access/count/navigation tests, resources/type/lint. Actual canonical registered seeded browser at375/1280 with every PNG viewed, independently reviewed, normal PR Closes6258 to green/main merge. Discovery/unit/static is not native browser acceptance. #6163 create-output provenance gap is outside this page.
