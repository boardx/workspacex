# Devapp billing activation

Target: `https://devapp.boardx.us`. Run the local commands from the repository root with Node 22+ and an authenticated GitHub CLI. The commands below prepare and activate real provider resources when executed. Keep the source `.env.local`, generated payload and preparation state private; never print them or attach them to an issue.

## Prepare Stripe independently

The existing Stripe secret key and reference payment link in `.env.local` are inputs. Preparation reads the reference price and quantity, creates or reuses resources tagged `application=workspacex,target=devapp,config_version=1`, and stages the owned link inactive and webhook disabled. It does not repoint the reference link or webhook. Stripe preparation state includes the webhook signing secret, which Stripe returns only when creating the webhook; retain the protected state file for retries.

```bash
node scripts/billing/prepare-runtime.mjs --check --providers stripe --env .env.local
node scripts/billing/prepare-runtime.mjs --prepare-stripe --providers stripe --env .env.local --output .harness/state/.cache/billing/devapp-stripe.json
```

The first command reports readiness without creating resources. The second writes a `0600` payload and protected retry state under `.harness/state/.cache/billing/`. A Stripe-only payload can be installed while WeChat is incomplete; the root helper preserves any previously installed WeChat configuration.

Stripe's [payment link creation API](https://docs.stripe.com/api/payment-link/create) does not accept `active=false`; its [webhook creation API](https://docs.stripe.com/api/webhook_endpoints/create) does not accept `disabled=true`. New objects therefore have an unavoidable active interval between creation and the immediate staging update. Keep the new link private until configuration completes. A crash or connection loss during that interval can require an operator to inspect and disable the owned objects before retrying; staging cannot guarantee that creation is inactive atomically.

## Deliver through the protected environment

After the changes are merged and the normal main deployment has completed, configure required reviewers for the existing GitHub environment `devapp-trusted-scripts`. Store the payload as that environment's secret through stdin:

```bash
gh secret set DEVAPP_BILLING_CONFIG_JSON --env devapp-trusted-scripts < .harness/state/.cache/billing/devapp-stripe.json
gh workflow run devapp-install-trusted-scripts.yml --ref main
```

Approve the installer in GitHub and wait for its successful completion before dispatching billing configuration. To find and watch its run:

```bash
gh run list --workflow devapp-install-trusted-scripts.yml --branch main --limit 5
# Use the installer run ID shown above.
gh run watch INSTALLER_RUN_ID --exit-status
gh workflow run devapp-configure-billing.yml --ref main
gh run list --workflow devapp-configure-billing.yml --branch main --limit 5
# Use the configuration run ID shown above, and approve the protected environment.
gh run watch CONFIGURATION_RUN_ID --exit-status
```

Both workflows share the deployment mutex. The configuration workflow checks that its immutable revision is still current main and matches the installed trusted scripts; if main advances while approval is pending, dispatch again against current main. If trusted script hashes changed, run the trusted installer again first.

The privileged operation accepts only the fixed devapp JSON envelope over stdin. It writes root-owned `0600` `/etc/workspacex-billing/billing.env` and `/etc/systemd/system/workspacex-api.service.d/90-billing.conf`; it preserves `/opt/workspacex/deploy.env`. It restarts `workspacex-api.service`, verifies its new invocation and actual process environment, and requires three stable trustworthy health samples with the requested providers. Failed writes, restart, or readiness restore the previous files and restart the prior configuration. Recovery failure still requires operator inspection.

Only after runtime readiness does the workflow verify the owned Stripe resources, enable the webhook first, and activate the payment link second. If either activation call fails, it attempts both compensating updates: disable the link and disable the webhook. A failed compensating update requires operator inspection. A failure during this final provider step leaves the runtime configured; investigate the failed run and retry the workflow after resolving the cause.

Verify public availability without credentials:

```bash
curl --fail --silent --show-error https://devapp.boardx.us/api/billing/config
```

Expect `enabledProviders` to contain `stripe`. This confirms runtime availability, not a completed payment. A customer checkout and signed webhook that update the intended user's subscription are the separate end-to-end acceptance check. Stripe subscriptions do not add recharge credits.

## Add WeChat when its public verification material is available

The merchant private key signs outbound requests. The WeChat platform public key verifies payment notifications; obtain it and its matching `PUB_KEY_ID_...` from the merchant platform. The merchant signing public key cannot replace this platform verification key.

Supply all of these `.env.local` fields: `WECHAT_PAY_APP_ID`, `WECHAT_PAY_MCH_ID`, `WECHAT_PAY_API_V3_KEY`, `WECHAT_PAY_MCH_SERIAL_NO`, `WECHAT_PAY_PRIVATE_KEY` (or `WECHAT_PAY_PRIVATE_KEY_PATH`), `WECHAT_PAY_PLATFORM_PUBLIC_KEY` (or `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH`), and `WECHAT_PAY_PLATFORM_KEY_ID`. Paths are resolved locally; the payload contains PEM contents and never arbitrary server file paths. The tool pins the notification URL to `https://devapp.boardx.us/api/billing/webhooks/wechat`.

```bash
node scripts/billing/prepare-runtime.mjs --check --providers wechat --env .env.local
```

If this reports missing platform public PEM or key ID, obtain those matching values before requesting WeChat activation. Once WeChat is ready, prepare both providers using the retained Stripe state, update the protected secret, and repeat the protected workflow sequence:

```bash
node scripts/billing/prepare-runtime.mjs --prepare-stripe --providers stripe,wechat --env .env.local --output .harness/state/.cache/billing/devapp-billing.json
gh secret set DEVAPP_BILLING_CONFIG_JSON --env devapp-trusted-scripts < .harness/state/.cache/billing/devapp-billing.json
```

Preparing both providers stages the owned Stripe resources again; finish the workflow sequence to restore their active state. Public configuration must then contain both `wechat` and `stripe`. WeChat merchant approval and an actual signed payment notification remain necessary for full payment acceptance.
