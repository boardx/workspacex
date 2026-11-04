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

These costs are not product credit tariffs. 用户已授权供应商成本×10；统一使用当前live storefront最小CNY充值档作为人民币↔credit基准，逐请求向上取整到0.01 credit。不能使用历史seed或自行固定兑换比例。多个同价最小档、无CNY充值档或报价快照变化会明确失败。

## Existing activation path

1. In the devapp deployment set KERNEL_IMAGE_PROVIDER=bailian and use the same-region DashScope account/key as the text provider. Keep model default qwen-image-3.0. An explicit OpenAI selection rejects these Qwen profiles rather than silently generating with OpenAI. Do not change KERNEL_AI_PRODUCT_QUOTA_ENABLED to evade an existing quota policy.
2. In the current default credit-only deployment, no platform-test/formal-model registration is required for this native tool: kernel.module.ts wires nativeWiring?.image ?? new PgCreditImageAdmission(db), which verifies run/lease/owner and reserves the explicit credit tariff before dispatch. This is the existing product path, not a bypass. For quota-enabled deployments, use the existing platform model administration to register/verify formal models and account scope. Catalog rows alone remain availability=unknown and have null billing. If product quota is enabled, trusted deployment AiQuotaRuntimeConfiguration.nativeBounds must bind each formalModelId to bailian-image/runtimeModelId, unit=image, maximumQuantity=1; verifyDeploymentBinding checks actual account/endpoint; authorizeDispatch permits only current owner/run/lease and the exact fixed body. Set the existing policy nativePrices for the same bindings with quantum=1, maxQuantity=1, currency=CNY, version tied to the verified price observation. The three Beijing micros above apply only after matching that region. Default Kernel configuration is null; there is no environment JSON switch that magically supplies these trusted callbacks.
3. Configure product credit prices through the existing platform-operator API, which writes credit_native_tariffs and credit_native_tariff_changes. GET and PUT /platform/billing/consumption/native-tariffs enforce platform operator authority. Every row is scoped to the selected devapp org. No direct SQL write or cross-org batch is needed.

```sh
# Load these from an existing devapp operator session without placing them in shell history:
# QWEN_ACTIVATION_COOKIE (or COOKIE_FILE), QWEN_ACTIVATION_ORG_ID
# QWEN_ACTIVATION_REGION=cn-beijing only after checking the actual deployment account/host
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us pnpm exec tsx apps/api/scripts/activate-qwen-image.ts
# Fetch current live catalog, select its minimum CNY topup, show exact10x proposed tariffs (no writes):
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --markup10
# Apply only these three models in the specified org using the existing audited operator API:
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --markup10 --apply
# Explicit approved row files remain supported:
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --apply /secure/path/approved-image-tariffs.json
```

For --markup10, QWEN_ACTIVATION_REGION must explicitly equal cn-beijing after the operator verifies deployment account/host region; it does not default to Beijing. QWEN_ACTIVATION_COOKIE_FILE may point to a protected file containing the current devapp Cookie header value; secrets are never printed. QWEN_ACTIVATION_CATALOG_SNAPSHOT may hold an existing /billing/catalog response for offline dryrun, labelled not live verified; application requires an authenticated live re-read and equality check immediately before writes. Dryrun prints selected SKU/catalog version/amountMinor/credits, Beijing supplier costs and10x customer micros. Formula: ceil(supplierMicros ×10 × selectedCreditQuantity ×100 / (selectedAmountFen ×10000)), entirely BigInt. Tariff version includes region/markup and a hash of the exact quote and cost metadata. Save the displayed proposal as the configuration evidence; server credit_native_tariff_changes captures actor/old/new/version. The existing API audits each row independently, not one atomic three-row transaction.

Explicit approved JSON is an array of three existing NativeCreditTariff objects. Each object has the chosen orgId, modelProvider=bailian-image, one modelId from the table, unit=image, quantum="1", hundredthsPerQuantum="<approved positive integer>", version="<approved version>". The script validates all three before any PUT, refuses other hosts/orgs/providers/models, defaults to GET, never dispatches a supplier request, and logs no authentication data. PUTs are individually audited; if a later PUT fails, rerun GET to review the partial state before continuing.

4. GET /platform/model-tests/candidates?orgId=... is the existing platform admission diagnostic. Important current limitation: PlatformTestImageClient supports wanx-async only. Do not register Qwen/Z against that adapter or use its green result as image-route evidence. Use the actual general-assistant product path after correct runtime registration; extending the independent platform test adapter is separate work.
5. Restart/new general-assistant run loads the latest published visual-content 1.0.2 through PgEnabledSkillVersionReader; explicit user version pins remain unchanged. Ask (a) "生成一张普通的山水配图" (b) "生成复杂高清科幻城市插画" (c) "生成一个蓝色日历icon". Verify read/call of visual-content, actual wx_image_generate arguments, model/task/receipt, credit reservation+settlement, artifact publish staged+writeback, authenticated artifact read and browser image display. Record PNG SHA and1024/2048 dimensions. No current evidence claims these deployed runs succeeded.
6. Induce one provider failure using a controlled test deployment. Tool outcome must remain failure, no artifact receipt may be invented. Skill instructions prohibit marking the image step completed, but there is no exact tool-call-to-plan-step identity in the current protocol; rubric/todo behavior is not a mechanical proof against every false "7/7" report.

Missing tariff fails credit_native_tariff_missing before supplier dispatch. Missing product native binding/policy fails AI_IMAGE_POLICY_UNCONFIGURED. A key alone is insufficient activation evidence.
