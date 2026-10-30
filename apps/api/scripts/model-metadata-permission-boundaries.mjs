/** Reviewed metadata boundaries, checked by the existing production permission gate.
 * No Artifact ACL is invented; caller authority, transaction scope and frozen binding
 * remain mandatory. Supporting behavior tests do not substitute for these checks. */
const exact=text=>new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
export const modelMetadataPermissionBoundaries=new Map([
  ["src/infrastructure/billing/pg-auxiliary-model-accounting.ts", {
    tables:["auxiliary_model_operations","auxiliary_model_requests"],
    reason:"#5894: private auxiliary operation/request rows contain only server-created payer identity, pinned model, finite expiry, immutable request hash/cap and timestamps. They contain no prompt, response or Artifact content and create no formal agent run/chat. Trusted gateway principal creates the owner; authenticated private callback resolves that persisted operation under tenant RLS, never a body-supplied payer. New starts require active operation and exact model/body binding; terminal receipts only resolve an admitted request, including after closure. Financial resolvePayer rechecks same-org membership and selects the wallet. private-auxiliary-credit-pg.test.ts proves zero HTTP at zero credit, actual reported usage debit/replay, foreign tenant/missing user refusal, changed body/model denial and closure/expiry fences. This exception is invalid if metadata expands to content or any listed authority/immutability check disappears.",
    checks:[
      [null,exact("this.db.withTenant(orgId")],
      [null,exact("WHERE org_id=$1 AND id=$2 FOR UPDATE")],
      [null,exact("if(!op?.active||op.model_provider!==provider||op.model_id!==input.modelId)")],
      [null,exact("stored.body_hash!==createHash('sha256').update(input.serializedBody).digest('hex')||stored.output_cap!==input.outputTokenLimit||stored.operation_id!==id")],
      [null,exact("if(!row.active||row.model_id!==input.modelId")],
      [null,exact("WHERE r.org_id=$1 AND r.operation_id=$2 AND r.request_id=$3")],
      [null,exact("new PgCreditConsumption(this.db).resolvePayer(orgId,row.user_id)")],
      ["src/infrastructure/billing/credit-model-gateway.ts",exact("scope.userId !== userId")],
      ["src/interface/controllers/auxiliary-model-usage.controller.ts",exact("!timingSafeEqual(expected,actual)")],
      ["tests/billing/private-auxiliary-credit-pg.test.ts",exact("private credit refusal restores trusted recharge guidance, never matching arbitrary vendor text")],
    ],
  }],
  ["src/infrastructure/billing/credit-model-gateway.ts", {
    tables:["agent_runs","chat_messages","chat_threads","subtask_runs"],
    reason:"#5877: reads only persisted run payer and execution identity, never message content. Server principal must match same-org run author; the downstream atomic wallet reservation rechecks membership. Missing or mismatched subject prevents physical dispatch. credit-model-gateway.test.ts and credit-model-pg.integration.test.ts prove zero-dispatch refusal and actual receipt debit.",
    checks:[[null,exact("scope.orgId !== orgId")],[null,exact("scope.userId !== userId")],[null,exact("await meter.startRequest(orgId")]],
  }],
  ["src/infrastructure/billing/pg-credit-consumption.ts", {
    tables:["organizations","org_memberships","credit_native_tariffs","ai_request_reservations"],
    reason:"#5877: financial configuration and authenticated same-org payer metadata have no Artifact content ACL. Admission rechecks persisted org membership, locks payer wallet, snapshots configured tariffs and validates immutable request facts. Settlement only uses an admitted request identity. credit-consumption-pg.test.ts covers cross-org wallets, concurrent holds, replay and revoked-member settlement.",
    checks:[[null,exact("JOIN org_memberships m ON m.org_id=o.id WHERE o.id=$1 AND m.user_id=$2")],[null,exact("credit_start_replay_mismatch")],[null,exact("await settleCreditReceipt(s,orgId,usage)")],["src/infrastructure/billing/pg-credit-receipt.ts",exact("credit_receipt_provenance_mismatch")]],
  }],
  ["src/infrastructure/billing/pg-credit-receipt.ts", {
    tables:["credit_consumption_receipts"],
    reason:"#5997: immutable financial usage receipt metadata, not Artifact content. Tenant RLS and the composite request/org foreign key bind receipts to the admitted physical request. Settlement rechecks actor/model/run/wallet identity under the wallet and request locks; no raw receipt rows leave this boundary. credit-stream-settlement.test.ts covers cumulative deduplication and cross-tenant receipt isolation; credit-consumption-pg.test.ts covers rejected provenance and revoked-member completion.",
    checks:[[null,exact("WHERE request_id=$1 AND org_id=$2")],[null,exact("row.user_id !== usage.userId")],[null,exact("credit_receipt_provenance_mismatch")],[null,exact("credit_receipt_replay_mismatch")]],
  }],
  ["src/infrastructure/billing/pg-native-credit-tariff-repository.ts", {
    tables:["credit_native_tariffs"],
    reason:"#5877: native credit prices are tenant financial metadata, not content. Public controller passes authenticated principal to NativeCreditTariffService, which checks the actual platform operator before any read/write. Tenant RLS isolates organization prices; immutable audit records actor and old/new price. native-credit-tariff-pg.test.ts and consumption-settings.test.ts prove operator refusal and tenant isolation.",
    checks:[[null,exact("this.db.withTenant(toOrgId(orgId)")],["src/application/billing/native-credit-tariff-service.ts",exact("if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden()")],[null,exact("INSERT INTO credit_native_tariff_changes")]],
  }],
  ["src/infrastructure/model/platform-test-wiring.ts", {
    tables:["organization_plans", "organization_ai_policies"],
    reason:"#5374: reads only same-organization model deployment/policy configuration after repository.authorizeActor verifies actual platform operator and member. Candidate GET never creates quota windows or dispatches. Actual prepare revalidates enabled model, trusted deployment binding/account, immutable price and exact bounded body under the authorized accounting transaction. No raw policy/credential response. tests/model/platform-model-test-wiring.test.ts proves denied operator reads zero models/policy, GET never resolves a member window, unconfigured/revoked models cause zero HTTP and terminal replay only settles existing usage. Remove entry if these conditions change.",
    checks:[
      [null,exact("await deps.repo.authorizeActor(actor);const models=await pool(deps.db).listForOrg(actor.orgId)")],
      [null,exact("pool(scoped).listForOrg(op.request.orgId)")],
      [null,exact("policy(scoped).resolveBudgetPolicy(toOrgId(op.request.orgId),op.operatorUserId")],
      [null,exact("beforeDispatch:async call=>{assertPrepared(op,state,call);")],
      [null,exact("await accounting.assertDispatch(op,call.physicalReceiptId);")],
      [null,exact("if(!await r.verifyDeploymentBinding())throw Error(\"TEST_BINDING_REVOKED\")")],
      [null,exact("m.serializedBodySha256!==sha(state.prepared.serializedBody)")],
      [null,exact("call.serializedBody!==state.prepared.serializedBody")],
      ["tests/model/platform-model-test-wiring.test.ts",exact("unauthorized candidate actor causes zero pool or configuration reads")],
    ],
  }],
  ["src/infrastructure/model/org-core-model-availability.ts", {
    tables:["organizations", "organization_ai_policies"],
    reason:"#5374: organization model configuration and deployment metadata have no Artifact/Segment ObjectRef. Candidate listing requires current organization admin before tenant reads; internal resolve rechecks the actual same-org run owner membership, verified deployment binding, purpose capabilities and immutable audited price. Returns public model metadata only, never policy content or credentials, and never writes budgets. Valid while tests/auth/org-core-model-controller-availability.test.ts denies non-admin/non-member access, missing capabilities and changed bindings, and strict public projection excludes private connection IDs.",
    checks:[
      [null,exact("findOrgMembership(actorId,orgId))?.orgRole!==\"admin\"")],
      [null,exact("if(!await new PgIdentityRepository(scoped).findOrgMembership(actorId,orgId))return null;")],
      [null,exact("SELECT configuration,price_version FROM organization_ai_policies WHERE org_id=$1")],
      [null,exact("registry.formalModelId(registration.binding.modelProvider,registration.binding.runtimeModelId)!==row.modelId")],
      [null,exact("deployment.coreModelRequiredCapabilities.some(tag=>!tag.trim()||!row.capabilityTags.includes(tag)||!registration.binding.capabilityTags.includes(tag))")],
      ["tests/auth/org-core-model-controller-availability.test.ts",exact("NOT_ORG_ADMIN")],
    ],
  }],
  ["src/infrastructure/model/pg-org-core-model-repository.ts", {
    tables:["organizations", "organization_core_models", "organization_core_model_changes", "agent_run_core_model_snapshots", "subtask_runs"],
    reason:"#5374: core preference/audit and immutable run binding are runtime configuration, not per-Artifact content. Writes repeat actual org-admin membership and version/availability under tenant transaction; public reads pass readOrgCoreModel admin use case. Internal snapshot assertion is called only at already-admitted run paid boundaries and validates frozen binding without exposing snapshot or reading current preference. Tests/auth/org-core-model.test.ts, org-core-model-snapshot.test.ts and capability/model/org-core-model-real-db.test.ts cover unauthorized organization writes, immutable replay and changed deployment refusal. Remove this boundary if these guards are removed or arbitrary snapshot disclosure is added.",
    checks:[
      [null,exact("findOrgMembership(input.actorId,orgId))?.orgRole!==\"admin\"")],
      [null,exact("if(current.version!==input.expectedVersion)")],
      [null,exact("INSERT INTO organization_core_model_changes")],
      [null,exact("if(!current||!sameCoreModelBinding(frozen,current))")],
      ["src/kernel.module.ts",exact("return creditModelGateway(guardCoreModelCalls(raw,createCoreModelRuntimeGuard(db,new VerifiedOrgCoreModelAvailability(db,configuration,raw))),db,creditUsageMeter(db))")],
      ["src/kernel.module.ts",exact("new PgRuntimeModelUsageRepository(db,usage,new PgAiAdmissionRepository(db),wiring?.runtime,guard)")],
      ["src/infrastructure/auth/pg-runtime-model-usage-repository.ts",exact("await this.coreModelGuard?.assertAccepted(orgId,owner.root_run_id,coreModelScopedDb(s,orgId))")],
    ],
  }],
  ["src/infrastructure/model/pg-platform-model-test-repository.ts", {
    tables:["organizations", "platform_model_tests", "ai_request_reservations", "model_request_starts"],
    reason:"#5374: test state and accounting receipts are operator-owned runtime records, not Artifact/Segment content. Every read/write repeats actual platform operator and formal same-org membership, exact immutable test owner and tenant scope; no unscoped lookup, credential disclosure or caller-billed identity. Atomic accounting and dispatch are fenced by test row and actual same-org/member held receipt/start provenance. tests/model/pg-platform-model-test-repository.test.ts and tests/model/pg-platform-model-test-real-db.test.ts deny foreign org/operator, immutable input changes and invalid receipt binding; controller/service negatives verify strict authenticated attribution. Boundary invalid if those checks or tests are removed.",
    checks:[
      [null,exact("if(!await this.authority.isOperator(actor.operatorUserId,scoped,orgId))")],
      [null,exact("!await this.authority.identities(scoped).findOrgMembership(actor.operatorUserId,orgId)")],
      [null,exact("if(!row||row.operator_user_id!==actor.operatorUserId)")],
      [null,exact("previous.operator_user_id!==actor.operatorUserId||previous.input_hash!==hash(input)")],
      [null,exact("r.user_id=platform_model_tests.operator_user_id AND r.state='held'")],
      ["tests/model/pg-platform-model-test-repository.test.ts",exact("invisible foreign UUID collision is generic and uses no unscoped lookup")],
    ],
  }],
]);
