import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {expect,it} from "vitest";
const root=resolve(import.meta.dirname,"../../../..");
const inventory=JSON.parse(readFileSync(resolve(root,"docs/design/platform-organizations-usage/dispatch-inventory.json"),"utf8"));
it("counts audited actual dispatch primitives separately from producer routes, and never invents an opaque global denominator",()=>{
 expect(inventory.productionEnforcement).toBe(false);expect(inventory.completeRepositoryDispatchPointTotal).toBeNull();
 const points=inventory.dispatchPoints as {id:string;source:string;anchor:string;receiptHook:string}[];
 const routes=inventory.retrievalProducerRoutes as {id:string;source:string;anchor:string;trustedRunReferencePropagationImplemented:boolean}[];
 for(const p of [...points,...routes])expect(readFileSync(resolve(root,p.source),"utf8").split(p.anchor).length-1,p.id).toBe(1);
 expect(new Set(points.map(p=>p.id)).size).toBe(points.length);
 expect(inventory.counts).toEqual({auditedConcreteDispatchPoints:points.length,receiptHooksImplemented:points.filter(p=>p.receiptHook==="implemented").length,receiptHooksContextSubset:points.filter(p=>p.receiptHook==="context-subset").length,receiptHooksMissing:points.filter(p=>p.receiptHook==="missing").length,knownRetrievalProducerRoutes:routes.length,trustedRunReferenceRoutesImplemented:routes.filter(p=>p.trustedRunReferencePropagationImplemented).length,trustedRunReferenceRoutesMissing:routes.filter(p=>!p.trustedRunReferencePropagationImplemented).length,opaqueExternalRoutes:inventory.opaqueExternalRoutes.length});
 expect(inventory.opaqueExternalRoutes.every((p:{actualVendorDispatchPointCount:unknown})=>p.actualVendorDispatchPointCount===null)).toBe(true);
});
