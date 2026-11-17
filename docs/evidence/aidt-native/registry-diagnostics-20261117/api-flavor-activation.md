# Explicit DevApp API flavor defaults

The first complete release used source `27b305e607281e54b4cf905269e30e26a35bee9e`, tag `44015992148-90000000000000000001`. Its Web build enabled the teaching and member-chat interface, and native deployment returned success. Anonymous `/aidt` changed from 404 to the proper login boundary.

The exact running-release probe `44020255177` then confirmed the application source, tag and manifest digests. However, both API module flags were **unset in Docker Config.Env**. This observation alone was not mislabeled an effective-process result. The API image sets NODE_ENV=production, the source's development-only local env loader skips production, and the two module gates require explicit 1/true values. A Web-only release option therefore cannot provide a self-contained enabled API default. The user's authenticated screenshot also shows a real course-load failure; it is not proof of an empty course roster or missing group membership.

## Narrow change

The existing explicit DevApp AIDT build flavor now passes the same admitted release intent into the API image's existing `ENABLE_AIDT_MODULE` and `ENABLE_PROJECT_MEMBER_CHAT` defaults. Ordinary image defaults remain 0. Dockerfile arguments accept only 0 or 1, and deployment-time explicit environment overrides remain authoritative. No private host configuration, permission/role, SQL, model credential or runtime TypeScript is changed.

The fresh producer verifies both API image defaults during its existing image inspect, before writing a receipt. An enabled image must contain one exact 1 for each key. An ordinary image may omit historical flags or contain one exact 0; duplicate, invalid, missing-enabled or unexpected-on values fail closed. Existing installed/native callers do not pass the new optional expectation and keep their compatibility behavior. The source/tag/platform/config/manifest and DevApp-only namespace safeguards remain.

The next enabled build **must use a source containing this Dockerfile change**. Reusing old source 27b with new control arguments intentionally fails the enabled-image check, rather than pretending ignored arguments activated the API. A new complete same-attempt five-image set, native release and post-release runtime/read-only HTTP verification are required. The old partial/full release artifacts are not mixed into it.

## Validation and limits

All 73 registry Python tests passed, including the previous 66 and new enabled/ordinary/legacy/malformed/mismatch counterexamples and actual shell validation of Dockerfile argument values. An independent delegated review also ran those 73 tests and accepted the source. These are local command simulations and do not claim a new image, effective runtime flag, authenticated group workflow or model acceptance.

The complementary auth-only GET lane in PR #6698 does not change document authorization, create projects, send messages or invoke models. Its first run `44024247851` stopped at an incomplete shared checkout before credential preflight; it did not establish that QA credentials were missing or that login failed. Its isolated source setup is being corrected separately.
