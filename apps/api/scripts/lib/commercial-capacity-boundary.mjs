import ts from "typescript";
export const COMMERCIAL_CAPACITY_PATH = "src/infrastructure/org-capacity/pg-commercial-capacity.ts";
const expectedSql = new Set([
 "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
 "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
 "SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1",
 "SELECT generation,purchased_seats::text,pending_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1",
 "SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",
 "UPDATE org_commercial_licenses SET pending_seats=NULL,pending_purchase_ref=NULL,updated_at=now() WHERE org_id=$1 AND generation=$2 AND pending_purchase_ref=$3 AND purchased_seats IS NOT NULL RETURNING org_id",
 "DELETE FROM org_commercial_licenses WHERE org_id=$1 AND generation=$2 AND pending_purchase_ref=$3 AND purchased_seats IS NULL RETURNING org_id",
]);
const expectedImports = new Set(["../../application/ports/database.port", "../../application/org-capacity/commercial-capacity", "../../domain/billing/billing-generation", "../billing/personal-pricing-epoch"]);
const allowedCalls = new Set(["s.query", "lockCapacityEpoch", "requireActivePricingEpoch", "resolveCommercialCapacity", "readCommercialCapacity", "lockOrganizationCapacity", "BigInt"]);
/** Admission metadata is the decision input, not ACL content; no row may be disclosed. */
export function checkCommercialCapacity(source, consumers = []) {
 const ast=ts.createSourceFile(COMMERCIAL_CAPACITY_PATH,source,ts.ScriptTarget.Latest,true),errors=[],methods=new Map(),sql=[];
 const compact=node=>node?.getText(ast).replace(/\s+/g,"");
 for(const node of ast.statements){
  if(ts.isImportDeclaration(node)){if(!expectedImports.has(node.moduleSpecifier.text))errors.push("unexpected capacity dependency");}
  else if(ts.isFunctionDeclaration(node)&&node.name)methods.set(node.name.text,node);
  else errors.push("only closed admission functions and dependencies are permitted");
 }
 const names=["lockCapacityEpoch","lockOrganizationCapacity","readCommercialCapacity","commercialSeatAvailable","closePendingCommercialIntent"];
 if(methods.size!==names.length||names.some(name=>!methods.has(name)))errors.push("capacity exports must remain the five internal admission helpers");
 const returns=new Map();
 for(const [name,node] of methods){
  const out=[];
  function visit(n){
   if(ts.isReturnStatement(n))out.push(n.expression);
   if(ts.isCallExpression(n)){
    if(!allowedCalls.has(compact(n.expression)))errors.push("unexpected call or disclosure surface");
    if(ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==="query"){
     const statement=n.arguments[0];
     if(!statement||!ts.isStringLiteral(statement)||!expectedSql.has(statement.text))errors.push("only exact scoped admission SQL is permitted");
     else{sql.push(statement.text);const params=n.arguments[1];if(!params||!ts.isArrayLiteralExpression(params)||compact(params.elements[0])!==(name==="lockCapacityEpoch"?"BILLING_PRICING_EPOCH_LOCK":"orgId"))errors.push("query tenant/epoch parameter binding required");}
    }
   }
   ts.forEachChild(n,visit);
  }
  visit(node);returns.set(name,out);
 }
 if(sql.length!==expectedSql.size||new Set(sql).size!==expectedSql.size)errors.push("admission SQL set changed");
 for(const name of ["lockCapacityEpoch","lockOrganizationCapacity"])if(returns.get(name)?.length)errors.push("lock helper cannot disclose values");
 const read=returns.get("readCommercialCapacity")??[],legacy=read[0];
 if(read.length!==2||!legacy||!ts.isObjectLiteralExpression(legacy)||legacy.properties.length!==1||compact(legacy.properties[0]?.name)!=="kind"||!ts.isStringLiteral(legacy.properties[0]?.initializer)||legacy.properties[0].initializer.text!=="legacy")errors.push("capacity read must return only legacy or canonical decision");
 const resolved=read[1];
 if(!resolved||!ts.isCallExpression(resolved)||compact(resolved.expression)!=="resolveCommercialCapacity"||resolved.arguments.length!==3||compact(resolved.arguments[0])!=="BILLING_ACCOUNTING_GENERATION"||compact(resolved.arguments[1])!=="plan?{plan:plan.plan,billingGeneration:plan.billing_generation}:null"||compact(resolved.arguments[2])!=="license?{generation:license.generation,purchasedSeats:license.purchased_seats,pendingSeats:license.pending_seats,pendingPurchaseRef:license.pending_purchase_ref}:null")errors.push("raw Plan/license rows must never leave the decision helper");
 if(JSON.stringify((returns.get("commercialSeatAvailable")??[]).map(compact))!==JSON.stringify(["null","false","true","members!==undefined&&BigInt(members.n)<capacity.seats"]))errors.push("seat admission may disclose only its boolean/legacy decision");
 if(JSON.stringify((returns.get("closePendingCommercialIntent")??[]).map(compact))!==JSON.stringify(["true","pending.rows.length>0"]))errors.push("pending close may disclose only a boolean");
 for(const {path,source:body} of consumers){
  if(!body.includes("pg-commercial-capacity"))continue;
  const file=ts.createSourceFile(path,body,ts.ScriptTarget.Latest,true);
  function visit(n){
   const spec=(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))?n.moduleSpecifier:ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(file)==="require")?n.arguments[0]:undefined;
   if(spec&&ts.isStringLiteral(spec)&&spec.text.includes("pg-commercial-capacity")&&(ts.isExportDeclaration(n)||!path.startsWith("src/infrastructure/")))errors.push(`capacity metadata is internal admission only: ${path}`);
   ts.forEachChild(n,visit);
  }visit(file);
 }
 return errors;
}
