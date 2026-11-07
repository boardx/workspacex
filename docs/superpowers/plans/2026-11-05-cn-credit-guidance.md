# CN credit guidance

User approved 2026-11-05: one friendly insufficient-credit notice with recharge navigation, preserve input, distinguish accounting outages. Reuse existing enterprise management and platform operator permissions. No grants or billing bypass.

1. Add a regression proving terminal CREDIT_REQUIRED without payer metadata offers the account billing page, never an invented payer. Outages never offer recharge. External payload URLs never become navigation targets.
2. Update shared credit guidance and notice. Known verified payer links retain their scoped checkout. Unknown payer goes to /billing for account review, without opening a checkout for an assumed payer.
3. Run focused web regressions, typecheck, create develop PR for #6225. Production deployment and real-browser failure verification remain separate evidence.
4. Operational: grant the two human-confirmed existing CN identities using platform_admins, verify persisted rows and browser platform organization/member pages. Enterprise upgrade itself is not requested for a specific organization.
