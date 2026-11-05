> #6267 fixed-price update: customer prices per image are Z-Image CNY0.25, Qwen3 CNY0.50, Qwen3 Pro CNY1.00. These supersede cost-times-ten pricing. Use `--fixed-prices`; `--markup10` is rejected. Credit amounts come from the authenticated live CNY pricing basis with integer ceiling to 0.01 credit. Writes target only the explicitly selected organization through the audited operator API. Activation of one organization does not activate other existing or future organizations, CN as a whole, or all environments. Global defaults/new-organization initialization require a separate design and issue. Live activation evidence is maintained by the server operator; the implementation tests below do not prove production activation. Historical cost observations below describe supplier costs, not current customer prices.

# Devapp activation for #6245

No activation was performed. Available local credentials contain CN production DB URIs, not devapp DB or an authenticated devapp operator session. They were not used. Do not substitute production credentials.

## Fixed dispatch and official supplier costs

Observed 2026-11-05, China Beijing, single text-to-image, no input images:

| Profile | Runtime model (provider=bailian-image) | Dimensions | Supplier CNY/image | Native cost micros |
| --- | --- | --- | --- | --- |
| standard | qwen-image-3.0 | 1024x1024 | 0.18 | 180000 |
| complex | qwen-image-3.0-pro | 2048x2048 | 0.50 | 500000 |
| icon | z-image-turbo | 1024x1024 | 0.10 | 100000 |

Sources: [standard](https://help.aliyun.com/zh/model-studio/qwen-image-3-0), [pro](https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro), [Z](https://help.aliyun.com/zh/model-studio/z-image-turbo). Z uses prompt_extend=false. Prices exclude promotions. Singapore has different rates; these numbers must not be reused there. Runtime derives a recognized official DashScope host from KERNEL_MODEL_BASE_URL; explicit KERNEL_BAILIAN_IMAGE_BASE_URL takes precedence.


## Existing activation path

1. In the devapp deployment set KERNEL_IMAGE_PROVIDER=bailian and use the same-region DashScope account/key as the text provider. Keep model default qwen-image-3.0. An explicit OpenAI selection rejects these Qwen profiles rather than silently generating with OpenAI. Do not change KERNEL_AI_PRODUCT_QUOTA_ENABLED to evade an existing quota policy.
2. In the current default credit-only deployment, no platform-test/formal-model registration is required for this native tool: kernel.module.ts wires nativeWiring?.image ?? new PgCreditImageAdmission(db), which verifies run/lease/owner and reserves the explicit credit tariff before dispatch. This is the existing product path, not a bypass. For quota-enabled deployments, use the existing platform model administration to register/verify formal models and account scope. Catalog rows alone remain availability=unknown and have null billing. If product quota is enabled, trusted deployment AiQuotaRuntimeConfiguration.nativeBounds must bind each formalModelId to bailian-image/runtimeModelId, unit=image, maximumQuantity=1; verifyDeploymentBinding checks actual account/endpoint; authorizeDispatch permits only current owner/run/lease and the exact fixed body. Set the existing policy nativePrices for the same bindings with quantum=1, maxQuantity=1, currency=CNY, version tied to the verified price observation. The three Beijing micros above apply only after matching that region. Default Kernel configuration is null; there is no environment JSON switch that magically supplies these trusted callbacks.
3. Configure product credit prices through the existing platform-operator API, which writes credit_native_tariffs and credit_native_tariff_changes. GET and PUT /platform/billing/consumption/native-tariffs enforce platform operator authority. Every row is scoped to the selected devapp org. No direct SQL write or cross-org batch is needed.

```sh
# Load these from an existing devapp operator session without placing them in shell history:
# QWEN_ACTIVATION_TOKEN_FILE=/secure/devapp-operator-token, QWEN_ACTIVATION_ORG_ID
# Optional QWEN_ACTIVATION_COOKIE_FILE is only for a trusted proxy/access cookie.
# QWEN_ACTIVATION_REGION=cn-beijing only after checking the actual deployment account/host
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts
# Fetch current live catalog, select its minimum CNY topup, show fixed customer-price tariffs (no writes):
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --fixed-prices
# Apply only these three models in the specified org using the existing audited operator API:
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --fixed-prices --apply
```


Application requires --fixed-prices --apply; arbitrary tariff JSON files are not accepted by this activation helper. All three calculated rows are validated before PUT, restricted to the chosen org and three fixed models. Every PUT is audited by the existing API and no authentication data is logged. PUTs are individually audited; if a later PUT fails, rerun the read-only check to review partial state before continuing.

4. GET /platform/model-tests/candidates?orgId=... is the existing platform admission diagnostic. Important current limitation: PlatformTestImageClient supports wanx-async only. Do not register Qwen/Z against that adapter or use its green result as image-route evidence. Use the actual general-assistant product path after correct runtime registration; extending the independent platform test adapter is separate work.
5. Restart/new general-assistant run loads the latest published visual-content 1.0.2 through PgEnabledSkillVersionReader; explicit user version pins remain unchanged. Ask (a) "生成一张普通的山水配图" (b) "生成复杂高清科幻城市插画" (c) "生成一个蓝色日历icon". Verify read/call of visual-content, actual wx_image_generate arguments, model/task/receipt, credit reservation+settlement, artifact publish staged+writeback, authenticated artifact read and browser image display. Record PNG SHA and1024/2048 dimensions. No current evidence claims these deployed runs succeeded.
6. Induce one provider failure using a controlled test deployment. Tool outcome must remain failure, no artifact receipt may be invented. Skill instructions prohibit marking the image step completed, but there is no exact tool-call-to-plan-step identity in the current protocol; rubric/todo behavior is not a mechanical proof against every false "7/7" report.

Missing tariff fails credit_native_tariff_missing before supplier dispatch. Missing product native binding/policy fails AI_IMAGE_POLICY_UNCONFIGURED. A key alone is insufficient activation evidence.

The new GET /platform/billing/consumption/image-pricing-basis?orgId=... is platform-operator-only and always reads the live cn credit_packages through the existing readProductConfiguration('cn') MVCC query and fingerprint. It is independent of the devapp storefront's US/CN market selection. It returns the existing PricingCatalog shape with market=cn and no payment providers (read-only basis, not a checkout offer). Missing CN rows or equal minimum prices return bounded503 diagnostics, and nonoperators cannot query another tenant or reach the repository. The CLI uses this endpoint, never a guessed market query parameter.

## CLI request wiring verified without network writes

The deployed nginx `/api/` proxy strips that prefix before forwarding to API:3200. The helper therefore requires the known `https://devapp.boardx.us/api` base, preserves it, rejects credentialed/foreign/root-only bases and disables redirects. It does not call a Next/BFF path at the site root.

Dryrun command (credentials are read only from protected operator input; this command was tested with mocked HTTP, not against the live site):

```sh
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api \
QWEN_ACTIVATION_TOKEN_FILE=/secure/devapp-operator-token \
QWEN_ACTIVATION_ORG_ID=selected-devapp-org \
QWEN_ACTIVATION_REGION=cn-beijing \
pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --fixed-prices
```

Expected sole dryrun request: `GET https://devapp.boardx.us/api/platform/billing/consumption/image-pricing-basis?orgId=selected-devapp-org`, no body. It sends the explicit Bearer token and, only if supplied, the auxiliary Cookie. It logs quote/prices, never either secret. The mocked apply path (no online writes) verifies two basis GETs, one tariff GET with encoded target-org query, and exactly three PUT bodies validated by the existing NativeCreditTariff contract to `/api/platform/billing/consumption/native-tariffs`. A changed quote blocks all PUTs. Unknown HTTP bodies are redacted; known missing/ambiguous CN basis diagnostics remain bounded and explicit.
