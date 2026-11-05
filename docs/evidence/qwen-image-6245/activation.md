# Global operator activation update — #6290

The current contracts use one global retail tariff per provider/model/unit for all personal and organization payers. Remove `QWEN_ACTIVATION_ORG_ID` (the helper explicitly rejects it); GET/PUT native-tariff and pricing-basis requests contain no organization field. Existing old request price snapshots stay immutable. See [design and switch/rollback](../../design/global-native-credit-tariffs-6290.md). Historical image supplier/API evidence below remains applicable; old per-org pricing instructions are superseded.

# Devapp activation for #6245 (global pricing update #6290)

No activation was performed. Available local credentials contain CN production DB URIs, not devapp DB or an authenticated devapp operator session. They were not used. Do not substitute production credentials.

## Fixed dispatch and official supplier costs

Observed 2026-11-05, China Beijing, single text-to-image, no input images:

| Profile | Runtime model (provider=bailian-image) | Dimensions | Supplier CNY/image | Native cost micros |
| --- | --- | --- | --- | --- |
| standard | qwen-image-3.0 | 1024x1024 | 0.18 | 180000 |
| complex | qwen-image-3.0-pro | 2048x2048 | 0.50 | 500000 |
| icon | z-image-turbo | 1024x1024 | 0.10 | 100000 |

Sources: [standard](https://help.aliyun.com/zh/model-studio/qwen-image-3-0), [pro](https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro), [Z](https://help.aliyun.com/zh/model-studio/z-image-turbo). Z uses prompt_extend=false. Prices exclude promotions. Singapore supplier costs differ. These Beijing costs are the approved canonical retail quote basis; promoting the same approved retail snapshot across deployments must not automatically reprice from their endpoint geography. Runtime derives a recognized official DashScope host from KERNEL_MODEL_BASE_URL; explicit KERNEL_BAILIAN_IMAGE_BASE_URL takes precedence.

These costs are not product credit tariffs. 用户已授权供应商成本×10；统一使用当前live storefront最小CNY充值档作为人民币↔credit基准，逐请求向上取整到0.01 credit。不能使用历史seed或自行固定兑换比例。多个同价最小档、无CNY充值档或报价快照变化会明确失败。

## Existing activation path

1. In the devapp deployment set KERNEL_IMAGE_PROVIDER=bailian and use the same-region DashScope account/key as the text provider. Keep model default qwen-image-3.0. An explicit OpenAI selection rejects these Qwen profiles rather than silently generating with OpenAI. Do not change KERNEL_AI_PRODUCT_QUOTA_ENABLED to evade an existing quota policy.
2. In the current default credit-only deployment, no platform-test/formal-model registration is required for this native tool: kernel.module.ts wires nativeWiring?.image ?? new PgCreditImageAdmission(db), which verifies run/lease/owner and reserves the explicit credit tariff before dispatch. This is the existing product path, not a bypass. For quota-enabled deployments, use the existing platform model administration to register/verify formal models and account scope. Catalog rows alone remain availability=unknown and have null billing. If product quota is enabled, trusted deployment AiQuotaRuntimeConfiguration.nativeBounds must bind each formalModelId to bailian-image/runtimeModelId, unit=image, maximumQuantity=1; verifyDeploymentBinding checks actual account/endpoint; authorizeDispatch permits only current owner/run/lease and the exact fixed body. Set the existing policy nativePrices for the same bindings with quantum=1, maxQuantity=1, currency=CNY, version tied to the verified price observation. The three Beijing micros above apply only after matching that region. Default Kernel configuration is null; there is no environment JSON switch that magically supplies these trusted callbacks.
3. Configure product credit prices through the existing platform-operator API, which writes credit_global_native_tariffs and credit_global_native_tariff_changes. GET and PUT /platform/billing/consumption/native-tariffs enforce platform operator authority. Each row is deployment-global for that model/unit; no organization selector, override, direct SQL or per-org batch is used.

```sh
# Load these from an existing devapp operator session without placing them in shell history:
# QWEN_ACTIVATION_TOKEN_FILE=/secure/devapp-operator-token (remove legacy QWEN_ACTIVATION_ORG_ID)
# Optional QWEN_ACTIVATION_COOKIE_FILE is only for a trusted proxy/access cookie.
# QWEN_ACTIVATION_REGION=cn-beijing only after checking the actual deployment account/host
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts
# Fetch current live catalog, select its minimum CNY topup, show exact10x proposed tariffs (no writes):
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --markup10
# Apply only these three models in the specified org using the existing audited operator API:
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --markup10 --apply
```

For --markup10, QWEN_ACTIVATION_REGION must explicitly equal cn-beijing after the operator verifies deployment account/host region; it does not default to Beijing. QWEN_ACTIVATION_TOKEN_FILE must point to the protected raw API session token (or use QWEN_ACTIVATION_TOKEN). The API resolver consumes Authorization: Bearer, not Cookie. QWEN_ACTIVATION_COOKIE_FILE may optionally carry a trusted proxy/access Cookie; Cookie alone is never treated as API authentication. Secrets are never printed. QWEN_ACTIVATION_CATALOG_SNAPSHOT may hold an existing operator image-pricing-basis response for offline dryrun, labelled not live verified; application requires an authenticated live re-read and equality check immediately before writes. Dryrun prints selected SKU/catalog version/amountMinor/credits, Beijing supplier costs and10x customer micros. Formula: ceil(supplierMicros ×10 × selectedCreditQuantity ×100 / (selectedAmountFen ×10000)), entirely BigInt. Tariff version includes region/markup and a hash of the exact quote and cost metadata. Save the displayed proposal as the configuration evidence; server credit_native_tariff_changes captures actor/old/new/version. The existing API audits each row independently, not one atomic three-row transaction.

Application requires --markup10 --apply; arbitrary tariff JSON files are not accepted by this activation helper. All three calculated rows are validated before PUT, restricted to the three fixed models, globally for every personal and organization payer. Every PUT is audited by the existing API and no authentication data is logged. PUTs are individually audited; if a later PUT fails, rerun the read-only check to review partial state before continuing.

4. GET /platform/model-tests/candidates?orgId=... is the existing platform admission diagnostic. Important current limitation: PlatformTestImageClient supports wanx-async only. Do not register Qwen/Z against that adapter or use its green result as image-route evidence. Use the actual general-assistant product path after correct runtime registration; extending the independent platform test adapter is separate work.
5. Restart/new general-assistant run loads the latest published visual-content 1.0.2 through PgEnabledSkillVersionReader; explicit user version pins remain unchanged. Ask (a) "生成一张普通的山水配图" (b) "生成复杂高清科幻城市插画" (c) "生成一个蓝色日历icon". Verify read/call of visual-content, actual wx_image_generate arguments, model/task/receipt, credit reservation+settlement, artifact publish staged+writeback, authenticated artifact read and browser image display. Record PNG SHA and1024/2048 dimensions. No current evidence claims these deployed runs succeeded.
6. Induce one provider failure using a controlled test deployment. Tool outcome must remain failure, no artifact receipt may be invented. Skill instructions prohibit marking the image step completed, but there is no exact tool-call-to-plan-step identity in the current protocol; rubric/todo behavior is not a mechanical proof against every false "7/7" report.

Missing tariff fails credit_native_tariff_missing before supplier dispatch. Missing product native binding/policy fails AI_IMAGE_POLICY_UNCONFIGURED. A key alone is insufficient activation evidence.

The new GET /platform/billing/consumption/image-pricing-basis is platform-operator-only and always reads the live cn credit_packages through the existing readProductConfiguration('cn') MVCC query and fingerprint. It is independent of the devapp storefront's US/CN market selection. It returns the existing PricingCatalog shape with market=cn and no payment providers (read-only basis, not a checkout offer). Missing CN rows or equal minimum prices return bounded503 diagnostics, and nonoperators cannot read or change platform pricing or reach the repository. The CLI uses this endpoint, never a guessed market query parameter.

## CLI request wiring verified without network writes

The deployed nginx `/api/` proxy strips that prefix before forwarding to API:3200. The helper therefore requires the known `https://devapp.boardx.us/api` base, preserves it, rejects credentialed/foreign/root-only bases and disables redirects. It does not call a Next/BFF path at the site root.

Dryrun command (credentials are read only from protected operator input; this command was tested with mocked HTTP, not against the live site):

```sh
QWEN_ACTIVATION_BASE_URL=https://devapp.boardx.us/api \
QWEN_ACTIVATION_TOKEN_FILE=/secure/devapp-operator-token \
QWEN_ACTIVATION_REGION=cn-beijing \
pnpm exec tsx apps/api/scripts/activate-qwen-image.ts --markup10
```

Expected sole dryrun request: `GET https://devapp.boardx.us/api/platform/billing/consumption/image-pricing-basis`, no body. It sends the explicit Bearer token and, only if supplied, the auxiliary Cookie. It logs quote/prices, never either secret. The mocked apply path (no online writes) verifies two basis GETs, one global tariff GET without organization query, and exactly three PUT bodies validated by the existing NativeCreditTariff contract to `/api/platform/billing/consumption/native-tariffs`. A changed quote blocks all PUTs. Unknown HTTP bodies are redacted; known missing/ambiguous CN basis diagnostics remain bounded and explicit.
