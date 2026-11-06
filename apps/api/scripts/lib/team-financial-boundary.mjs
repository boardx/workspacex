import ts from "typescript";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {posix,resolve} from "node:path";
import {fileURLToPath} from "node:url";
/** Org-admin/provider financial facts cannot use ACL ObjectRef organization (which allows every member).
 * Instead freeze the complete reviewed AST, including SQL predicates, conditions, calls and return projections.
 * Source remains authoritative; the digest is a derived drift gate, never a permission fact or runtime fallback.
 * Changes require explicit regeneration visible beside their source diff and independent security review. */
export const TEAM_REVIEW_FILES=[
 "src/application/billing/team-billing-error.ts","src/application/billing/team-billing-access.ts","src/application/billing/team-checkout-service.ts","src/application/billing/team-checkout-ports.ts","src/application/billing/team-account-service.ts","src/application/billing/team-payment-provider.port.ts",
 "src/domain/billing/team-purchase.ts","src/domain/billing/team-payment-decision.ts","src/domain/billing/team-ai-license.ts","src/domain/billing/team-payment-product.ts",
 "src/infrastructure/billing/team-financial-owner.ts","src/infrastructure/billing/team-product-configuration.ts","src/infrastructure/billing/pg-team-account-repository.ts","src/infrastructure/billing/pg-team-checkout-repository.ts","src/infrastructure/billing/pg-team-payment-repository.ts","src/infrastructure/billing/pg-team-quote-repository.ts",
 "src/infrastructure/billing/team-credit-admission.ts","src/infrastructure/billing/team-credit-terms.ts","src/infrastructure/billing/team-payment-reconciler.ts","src/infrastructure/billing/pg-team-recovery-sweep.ts","src/infrastructure/billing/team-wechat-crediting-store.ts","src/infrastructure/billing/team-wechat-payment-client.ts","src/infrastructure/billing/team-wechat-checkout-client.ts","src/infrastructure/billing/team-payment-recovery-worker.ts",
 // #6316: internal member-credit policy reads no content; admission first resolves trusted membership/payer
 // and locks the financial owner. Continuation binds request + org + user + team wallet. Real concurrent,
 // cross-tenant, UTC month and zero-allowance evidence: tests/billing/member-credit-quota-pg.test.ts.
 "src/infrastructure/billing/member-credit-quota.ts",
 // #6316: public quota read/edit endpoints require OrgAdminManagementController.requireOrgAdmin before
 // this repository; only member identity and actual usage aggregates leave it, never prompts or secrets.
 // Admin rejection-before-repository evidence: tests/billing/member-credit-quota-controller.test.ts.
 "src/infrastructure/billing/pg-member-credit-quota-repository.ts",
 "src/interface/controllers/team-billing.controller.ts","src/interface/controllers/team-billing-http-exception.ts",
];
export const TEAM_FINANCIAL_BOUNDARIES=new Set(TEAM_REVIEW_FILES.filter(p=>p.startsWith("src/infrastructure/")));
const snapshot=new URL("./team-financial-reviewed.json",import.meta.url);
const printer=ts.createPrinter({removeComments:true});
export function teamFinancialFingerprint(path,source){
 const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(parsed.parseDiagnostics.length)throw Error(`invalid TypeScript in ${path}`);
 return createHash("sha256").update(printer.printFile(parsed)).digest("hex");
}
export function checkTeamFinancialBoundary(path,source,read){
 const hashes=JSON.parse(readFileSync(snapshot,"utf8")),errors=[];
 if(!TEAM_FINANCIAL_BOUNDARIES.has(path))return ["unregistered Team financial reader"];
 for(const dependency of TEAM_REVIEW_FILES){
  try{if(hashes[dependency]!==teamFinancialFingerprint(dependency,dependency===path?source:read(dependency)))errors.push(`Team financial authority/projection changed: ${dependency}; update reviewed evidence and security review`);}
  catch{errors.push(`Team financial authority missing or invalid: ${dependency}`);}
 }
 return errors;
}
export function checkTeamFinancialConsumers(consumers){
 const approved=new Set([...TEAM_REVIEW_FILES,"src/billing.module.ts","src/infrastructure/billing/pg-credit-consumption.ts","src/interface/filters/all-exceptions.filter.ts"]),subjects=new Set(TEAM_REVIEW_FILES),errors=[];
 for(const {path,source} of consumers){
  if(approved.has(path)||!source.includes("team-"))continue;
  const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  function inspect(node){
   const specifier=ts.isImportDeclaration(node)?node.moduleSpecifier:ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:null;
   if(specifier&&ts.isStringLiteral(specifier)&&specifier.text.startsWith(".")){
    const target=posix.normalize(posix.join(posix.dirname(path),specifier.text.replace(/\.js$/,".ts")));
    if(subjects.has(target.endsWith(".ts")?target:`${target}.ts`))errors.push(`unreviewed Team financial consumer: ${path}`);
   }
   ts.forEachChild(node,inspect);
  }
  inspect(parsed);
 }
 return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes("--write")){
 const api=new URL("../../",import.meta.url),hashes=Object.fromEntries(TEAM_REVIEW_FILES.map(p=>[p,teamFinancialFingerprint(p,readFileSync(new URL(p,api),"utf8"))]));
 writeFileSync(snapshot,JSON.stringify(hashes,null,2)+"\n");
}
