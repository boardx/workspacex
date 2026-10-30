# Payment purchase channels

`BILLING_WECHAT_ENABLED` and `BILLING_STRIPE_ENABLED` independently control the
providers returned by `/billing/config`. The billing UI displays only returned
channels. Disabled channels reject new purchase requests; configured credentials
remain available for existing payment notifications and Stripe renewal callbacks.
Existing subscribers retain their management link, including cancellation, even
when new Stripe purchases are disabled.

| Environment | BILLING_WECHAT_ENABLED | BILLING_STRIPE_ENABLED | Credentials |
| --- | --- | --- | --- |
| CN | true | false | Production WeChat; retain existing Stripe callback configuration |
| US | false | true | Production Stripe |
| devapp | true | true | Test Stripe resources and the dedicated development WeChat configuration |

Both credentials and an enabled switch are required to advertise a channel.
Unset or empty switches preserve the previous credential-based behavior for
compatibility. `true`/`1` enable a channel; `false`/`0` and invalid nonempty values
disable it. Values are trimmed and case insensitive. Both switches are read once
at API startup; persist them in the environment's deployment configuration and
recreate the API container to apply environment changes. Restarting a Docker
container alone does not replace its environment. Do not remove provider keys to
hide a purchase channel: that would also disable outstanding payment callbacks.

Do not assume a local test key proves the deployed environment is in test mode.
Verify the running credential mode, matching payment-link/webhook resources,
public channel response and service health. Retain a private configuration backup
and the exact running image identity for rollback.
