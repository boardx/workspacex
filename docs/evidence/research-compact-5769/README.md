# Research compact pages — #5769

Real Next development route http://127.0.0.1:38752/research/new, current production ResearchNewRoute/ResearchIntake components. Synthetic manually entered requirement, no creation/model calls. Screenshots at 375/768/1280 plus expanded optional fields at 375. Geometry records no horizontal overflow, 192px goal editor, 36px main action and original floating assistant position. The main action and assistant do not overlap in the collapsed creation view.

The list route /research redirects to /login without a local API session. No claim of authenticated history-card, edit dialog, plan or report browser verification is made. Their business logic is unchanged; existing list regression covers rendering, resume, search, filters, metadata and failure recovery. Plan/report already use the shared action components; this patch does not change their states or evidence.

Validation: 75 related UI tests passed after updating the existing list spacing assertion. Web TypeScript and focused Next lint passed. The new intake assertion first failed on the old multiline placeholder, then passed with all optional fields retained. Existing file import and creation retry tests remain green.
