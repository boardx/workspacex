import ts from "typescript";
// Internal financial mutation metadata, reachable only through the platform-operator composition.
// Closed statements and identity bindings are reviewed here; this is not a tenant-content reader.
const reviewed = {
"src/infrastructure/billing/enterprise-credit-grant.ts": {
imports: ["../../domain/billing/billing-generation","./personal-pricing-epoch","node:crypto","@repo/contracts/billing-team","@repo/contracts/billing-credits","../../application/ports/database.port","../../domain/org-id","../../application/billing/enterprise-ports","../../application/billing/credit-consumption"],
queries: [["grant","SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE","[orgId]"],["grant","SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1 FOR UPDATE","[orgId]"],["grant","SELECT actor_id,generation,credits,reason,receipt FROM enterprise_credit_grants WHERE org_id=$1 AND idempotency_key=$2","[orgId,input.idempotencyKey]"],["grant","INSERT INTO credit_wallets(owner_type,owner_id) VALUES('team',$1) ON CONFLICT(owner_type,owner_id) DO NOTHING","[orgId]"],["grant","SELECT wallet_id,balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1 FOR UPDATE","[orgId]"],["grant","SELECT now() AS at",""],["grant","UPDATE credit_wallets SET balance=$2,total_granted=total_granted+$3,updated_at=now() WHERE wallet_id=$1","[wallet.wallet_id,decimal,input.credits]"],["grant","INSERT INTO credit_transactions(txn_id,wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason) VALUES($1,$2,'grant',1,$3,$4,'admin_grant',$5,$6,$7)","[ledgerRef,wallet.wallet_id,input.credits,decimal,grantRef,actorId,input.reason]"],["grant","INSERT INTO enterprise_credit_grants(id,org_id,generation,idempotency_key,actor_id,credits,reason,audit_ref,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)","[grantRef,orgId,BILLING_ACCOUNTING_GENERATION,input.idempotencyKey,actorId,input.credits,input.reason,auditRef,JSON.stringify(receipt)]"]],
returns: [["grant","tenant-transaction"],["grant","EnterpriseCreditGrantResult.parse(prior.receipt)"],["grant","receipt"]],
conditions: [["grant","!org.rows.length"],["grant","plan?.plan!==\"enterprise\"||plan.billing_generation!==BILLING_ACCOUNTING_GENERATION"],["grant","prior"],["grant","prior.generation!==BILLING_ACCOUNTING_GENERATION||prior.actor_id!==actorId||prior.credits!==input.credits||prior.reason!==input.reason"],["grant","!wallet"],["grant","!CreditBalance.safeParse(balance).success||!CreditBalance.safeParse(totalGranted).success"]],
calls: ["EnterpriseCreditGrantRequest.parse","this.db.withTenant","requireActivePricingEpoch","s.query","s.query","s.query","EnterpriseCreditGrantResult.parse","s.query","s.query","creditDecimal","creditHundredths","BigInt","Number","Number","creditDecimal","creditHundredths","BigInt","CreditBalance.safeParse","CreditBalance.safeParse","randomUUID","randomUUID","randomUUID","(awaits.query<{at:Date}>(\"SELECTnow()ASat\")).rows[0]!.at.toISOString","s.query","EnterpriseCreditGrantResult.parse","s.query","s.query","s.query","JSON.stringify"],
methods: ["grant"],
},
"src/infrastructure/billing/enterprise-no-paid-team.ts": {
imports: ["../../application/ports/database.port","../../domain/org-id","../../application/billing/enterprise-ports","./personal-pricing-epoch"],
queries: [["assertNoPaidTeam","SELECT generation,purchased_seats::text,pending_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1 FOR UPDATE","[orgId]"],["readPaidTeamTerm","SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE","[orgId]"]],
returns: [["readPaidTeamTerm","tenant-transaction"],["readPaidTeamTerm","null"]],
conditions: [["assertNoPaidTeam","license"],["readPaidTeamTerm","!(awaits.query(\"SELECTidFROMorganizationsWHEREid=$1ANDkind='organization'FORUPDATE\",[orgId])).rows.length"]],
calls: ["s.query","this.db.withTenant","requireActivePricingEpoch","s.query","assertNoPaidTeam"],
methods: ["assertNoPaidTeam","readPaidTeamTerm","stopFutureRenewal"],
},
"src/infrastructure/billing/enterprise-upgrade-store.ts": {
imports: ["./enterprise-no-paid-team","node:crypto","@repo/contracts/billing-team","../../application/ports/database.port","../../domain/org-id","../../domain/billing/billing-generation","../../application/billing/enterprise-ports","./personal-pricing-epoch"],
queries: [["lock","SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE","[orgId]"],["row","SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND operation_ref=$2 FOR UPDATE","[orgId,ref]"],["begin","SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND idempotency_key=$2","[orgId,input.idempotencyKey]"],["begin","SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND generation=$2 AND result->>'status' IN ('processing','needs_review') LIMIT 1","[orgId,generation]"],["begin","SELECT version FROM organization_plans WHERE org_id=$1","[orgId]"],["begin","SELECT now() AS at",""],["begin","INSERT INTO enterprise_upgrade_operations(org_id,operation_ref,actor_id,idempotency_key,expected_version,generation,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)","[orgId,operationRef,actorId,input.idempotencyKey,input.expectedPlanVersion,generation,JSON.stringify(result)]"],["pending","SELECT now() AS at",""],["pending","UPDATE enterprise_upgrade_operations SET result=$3::jsonb WHERE org_id=$1 AND operation_ref=$2","[orgId,ref,JSON.stringify(result)]"],["activate","SELECT plan,version FROM organization_plans WHERE org_id=$1 FOR UPDATE","[orgId]"],["activate","INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',$2,$3,$4) ON CONFLICT(org_id) DO UPDATE SET plan='enterprise',version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,billing_generation=EXCLUDED.billing_generation,updated_at=now() RETURNING updated_at","[orgId,prior.expectedPlanVersion+1,row.actor_id,generation]"],["activate","INSERT INTO organization_plan_changes(id,org_id,version,previous_plan,plan,actor_id,reason) VALUES($1,$2,$3,$4,'enterprise',$5,'enterprise_upgrade')","[auditRef,orgId,prior.expectedPlanVersion+1,plan?.plan??null,row.actor_id]"],["activate","UPDATE enterprise_upgrade_operations SET result=$3::jsonb WHERE org_id=$1 AND operation_ref=$2","[orgId,ref,JSON.stringify(result)]"]],
returns: [["row","row"],["begin","tenant-transaction"],["begin","EnterpriseUpgradeOperation.parse(existing.result)"],["begin","EnterpriseUpgradeOperation.parse(unresolved.result)"],["begin","result"],["read","tenant-transaction"],["read","EnterpriseUpgradeOperation.parse((awaitthis.row(s,orgId,ref)).result)"],["pending","tenant-transaction"],["pending","prior"],["pending","result"],["activate","tenant-transaction"],["activate","prior"],["activate","result"]],
conditions: [["lock","!(awaits.query(\"SELECTidFROMorganizationsWHEREid=$1ANDkind='organization'FORUPDATE\",[orgId])).rows.length"],["row","!row||row.generation!==generation"],["begin","existing"],["begin","existing.actor_id!==actorId||existing.expected_version!==input.expectedPlanVersion||existing.generation!==generation"],["begin","unresolved"],["begin","unresolved.actor_id!==actorId||unresolved.expected_version!==input.expectedPlanVersion"],["begin","(plan?.version??0)!==input.expectedPlanVersion"],["pending","prior.status!==\"processing\""],["activate","prior.status!==\"processing\""],["activate","(plan?.version??0)!==prior.expectedPlanVersion"],["activate","payment===null"]],
calls: ["requireActivePricingEpoch","s.query","s.query","EnterpriseUpgradeRequest.parse","this.db.withTenant","this.lock","s.query","EnterpriseUpgradeOperation.parse","s.query","EnterpriseUpgradeOperation.parse","s.query","(awaits.query<{at:Date}>(\"SELECTnow()ASat\")).rows[0]!.at.toISOString","s.query","randomUUID","EnterpriseUpgradeOperation.parse","s.query","JSON.stringify","this.db.withTenant","this.lock","EnterpriseUpgradeOperation.parse","this.row","this.db.withTenant","this.lock","this.row","EnterpriseUpgradeOperation.parse","(awaits.query<{at:Date}>(\"SELECTnow()ASat\")).rows[0]!.at.toISOString","s.query","EnterpriseUpgradeOperation.parse","s.query","JSON.stringify","this.db.withTenant","this.lock","this.row","EnterpriseUpgradeOperation.parse","s.query","assertNoPaidTeam","s.query","updated.updated_at.toISOString","randomUUID","EnterpriseUpgradeOperation.parse","s.query","s.query","JSON.stringify"],
methods: ["lock","row","begin","read","pending","activate"],
},
};
export const ENTERPRISE_FINANCIAL_PATHS = new Set(Object.keys(reviewed));
const compact=(node,ast)=>node?.getText(ast).replace(/\s+/g,"")??"";
function shape(path,source){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),out={imports:[],queries:[],returns:[],conditions:[],calls:[],methods:[]};
 function visit(node,method='module'){
  if(ts.isImportDeclaration(node))out.imports.push(node.moduleSpecifier.text);
  if(ts.isMethodDeclaration(node)||ts.isFunctionDeclaration(node)){method=compact(node.name,ast);out.methods.push(method);}
  if(ts.isCallExpression(node)){
   const call=compact(node.expression,ast);out.calls.push(call);
   if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='query'){
    const sql=node.arguments[0],params=node.arguments[1];
    out.queries.push([method,sql&&(ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))?sql.text.replace(/\s+/g,' ').trim():'DYNAMIC_SQL',compact(params,ast)]);
   }
  }
  if(ts.isReturnStatement(node)){const expression=node.expression;out.returns.push([method,expression&&ts.isCallExpression(expression)&&compact(expression.expression,ast)==='this.db.withTenant'?'tenant-transaction':compact(expression,ast)]);}
  if(ts.isIfStatement(node))out.conditions.push([method,compact(node.expression,ast)]);
  ts.forEachChild(node,n=>visit(n,method));
 }visit(ast);return out;
}
const wiringPath="src/enterprise-management.wiring.ts",controllerPath="src/interface/controllers/enterprise-management.controller.ts";
const consumersByModule={
 "enterprise-credit-grant":new Set([wiringPath]),
 "enterprise-upgrade-store":new Set([wiringPath]),
 "enterprise-no-paid-team":new Set([wiringPath,"src/infrastructure/billing/enterprise-upgrade-store.ts","src/infrastructure/billing/enterprise-summary.ts"]),
};
export function checkEnterpriseFinancialBoundary(path,source,consumers){
 const errors=[];
 if(!ENTERPRISE_FINANCIAL_PATHS.has(path))return ["Enterprise financial exception is limited to three exact internal files"];
 const actual=shape(path,source),expected=reviewed[path];
 for(const key of Object.keys(expected))if(JSON.stringify(actual[key])!==JSON.stringify(expected[key]))errors.push(`Enterprise ${key} changed: closed SQL, identity, lock order and receipt projection require review`);
 for(const {path:caller,source:body} of consumers){
  if(!body.includes("ENTERPRISE_MANAGEMENT")&&!Object.keys(consumersByModule).some(module=>body.includes(module)))continue;
  const ast=ts.createSourceFile(caller,body,ts.ScriptTarget.Latest,true);
  function visit(node){
   if(ts.isIdentifier(node)&&node.text==="ENTERPRISE_MANAGEMENT"&&![wiringPath,controllerPath,"src/application/billing/enterprise-ports.ts"].includes(caller))errors.push(`Enterprise service token cannot create another disclosure surface: ${caller}`);
   const spec=(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier:ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==="require")?node.arguments[0]:undefined;
   if(spec&&ts.isStringLiteral(spec))for(const [module,allowed] of Object.entries(consumersByModule))if(spec.text.endsWith('/'+module)&&(ts.isExportDeclaration(node)||!allowed.has(caller)))errors.push(`Enterprise financial metadata must stay in its platform composition: ${caller}`);
   ts.forEachChild(node,visit);
  }visit(ast);
 }
 const wiring=consumers.find(c=>c.path===wiringPath)?.source,controller=consumers.find(c=>c.path===controllerPath)?.source;
 if(!wiring||!controller)return [...errors,"Enterprise platform composition evidence missing"];
 const wa=ts.createSourceFile(wiringPath,wiring,ts.ScriptTarget.Latest,true);let factory;
 function findFactory(node){if(ts.isPropertyAssignment(node)&&node.name.getText(wa)==="useFactory")factory=compact(node.initializer,wa);ts.forEachChild(node,findFactory);}findFactory(wa);
 if(factory!=="(db:DatabasePort)=>enterpriseManagement(newEnterpriseUpgrade(newPgEnterpriseUpgradeStore(db),newEnterpriseNoPaidTeamAdapter(db)),newEnterpriseCreditGrant(db))")errors.push("Enterprise financial classes require the single reviewed composition");
 const ca=ts.createSourceFile(controllerPath,controller,ts.ScriptTarget.Latest,true);let platformGuard=false,guardImport=false;const actions=[],principalMethods=[];
 function inspectController(node){
  if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==="../guards/platform-operator.guard"&&compact(node.importClause,ca)==="{PlatformOperatorGuard}")guardImport=true;
  if(ts.isMethodDeclaration(node)&&["grant","upgrade","operation"].includes(compact(node.name,ca))){const principal=node.parameters.find(p=>compact(p.name,ca)==="principal");if(principal&&(ts.getDecorators(principal)??[]).some(d=>compact(d.expression,ca)==="CurrentPrincipal()"))principalMethods.push(compact(node.name,ca));}
  if(ts.isClassDeclaration(node)&&node.name?.text==="EnterpriseManagementController")platformGuard=(ts.getDecorators(node)??[]).some(d=>compact(d.expression,ca)==="UseGuards(PlatformOperatorGuard)");
  if(ts.isCallExpression(node)&&compact(node.expression,ca).startsWith("this.management."))actions.push(compact(node,ca));
  ts.forEachChild(node,inspectController);
 }inspectController(ca);
 if(!platformGuard||!guardImport)errors.push("Enterprise HTTP disclosure requires the real PlatformOperatorGuard");
 if(JSON.stringify(principalMethods)!==JSON.stringify(["grant","upgrade","operation"]))errors.push("Enterprise actor must come from CurrentPrincipal in every HTTP method");
 if(JSON.stringify(actions)!==JSON.stringify(["this.management.grant(toOrgId(orgId),principal.userId,input)","this.management.upgrade(toOrgId(orgId),principal.userId,input)","this.management.operation(toOrgId(input.orgId),input.operationRef)"]))errors.push("Enterprise HTTP identity must bind route organization and authenticated principal actor");
 return errors;
}
