# Directory role cards — issue #5704

final result: blocked

## Selected target
Implement the user's second role-card alternative within the existing white app shell: real role avatars, responsive three/two/one-column cards, organization/official tabs, task examples, and in-place official activation. Generated role names, avatars and capability claims are not seed data.

## Implemented scope
Reuse ResourceCard and the existing directory, official-offer, activation and chat-prefill APIs. Example tasks prefill a draft without sending it. Workflow associations are explicitly unconfirmed; metadata does not imply business acceptance. Session organization, account and token changes remount the workspace and abort previous activation requests.

## Regression coverage added
Real card rendering; existing chat route and encoded prefill; explicit activation and directory refresh; member permission boundary; stale directory responses; organization change during activation; token replacement during activation; readiness metadata not promoted to verified workflow execution.

## Execution evidence
Source and tests committed through the GitHub contents API on worker/digital-directory-cards-5704. No local shell or browser is exposed in this execution session. Local init.sh, compilation, tests and browser screenshots have not been run. PR CI results must be recorded separately at the exact final commit; authored tests are not passing-test evidence.

## Browser acceptance still required
Check the selected layout at desktop/tablet/mobile widths; keyboard navigation and focus; real avatar fallbacks; loading/denied/empty/error states; administrator and member official-role views; explicit activation followed by organization refresh; task example draft preservation; org/account switching during requests. Capture screenshots and compare with the user's second image. Do not mark visual acceptance complete without this evidence.

## Release boundary
Draft PR only. No merge, deployment, production configuration/data changes, additional account permissions, model calls or credentials are included.
