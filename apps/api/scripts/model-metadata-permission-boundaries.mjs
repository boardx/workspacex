/** Reviewed metadata boundaries, checked by the existing production permission gate.
 * No Artifact ACL is invented; caller authority, transaction scope and frozen binding
 * remain mandatory. Supporting behavior tests do not substitute for these checks. */
const exact=text=>new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
export const modelMetadataPermissionBoundaries=new Map([
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
      ["src/kernel.module.ts",exact("return guardCoreModelCalls(raw,createCoreModelRuntimeGuard(db,new VerifiedOrgCoreModelAvailability(db,configuration,raw)))")],
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
