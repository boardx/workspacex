# Integration evidence — #6298

Current source is stacked on image PR6297 exact2a7b6331d37a9d808fd00a9de961749e8c393b58. The earlier6d16 generic-all-model design is superseded; its local/CI results do not verify this new dual-source integration.

The nonimage1700 migration excludes every bailian-image key, reuses the image writer, and exposes only a read-only UNION compatibility view. Native platform organization/image writes reject explicitly. Image CAS/helper/activation content remains the approved base. Tests change old direct fixture writes only where the new app-read-only/view contract requires it; image payer coverage expands without changing prices.

This source preparation has not run new heavy gates. Required batches, subject to one resource window:

1. Pure HTTP/contract/image basis/UI and permission counterexamples; no DB bypass or pricing write to a real deployment.
2. One isolated Postgres/Redis batch: credit-consumption, native/image tariff PG plus fixture/accounting consumers, serial files; actual restricted writer provisioned only in isolated DB.
3. Exclusive DDL batch: native migration counterexamples, two full force passes, old snapshot settlement, default no-op, unchanged original historical checksum. Also actual verify-migrations schema/data digest comparison.
4. Normal typecheck/lint/pre-push and source CI. No passing/READY-to-merge claim before exact-tree evidence.

The old observed CI reds were precisely: missing0900 suffix caused release+Linux recovery failure; `simulation(all)` merely aggregated those failures; historical force replay attempted ALTER on the new view. New source retires0900, registers reviewed1600→1700, and restricts exact historical mapping to a verified cutover. Actual integration verification is still pending.

No merge, deployment, writer provisioning in production, price activation or new CN/US configuration has been performed here. Devapp's earlier18org emergency ASR restoration and successful user retest remain historical incident evidence; the global cutover must be released before newly created organizations inherit the global ASR price. Estimated supplier receipts still do not prove an authoritative final debit.
