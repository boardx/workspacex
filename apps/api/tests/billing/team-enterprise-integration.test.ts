import {expect,it,vi} from "vitest";
import type {ArgumentsHost} from "@nestjs/common";
import {operations} from "@repo/contracts/billing-team";
import {AllExceptionsFilter} from "../../src/interface/filters/all-exceptions.filter";
import {TeamBillingHttpException} from "../../src/interface/controllers/team-billing-http-exception";
import {EnterpriseHttpException,ENTERPRISE_CACHE_CONTROL} from "../../src/interface/controllers/enterprise-http-exception";

it.each([
 {path:operations.createTeamCheckout.path,error:new TeamBillingHttpException("quote_expired",409),code:"quote_expired"},
 {path:operations.createEnterpriseUpgrade.path,error:new EnterpriseHttpException("PLAN_VERSION_CONFLICT",409),code:"PLAN_VERSION_CONFLICT"},
])("retains the closed $code envelope and financial cache policy after composition",({path,error,code})=>{
 const json=vi.fn(),setHeader=vi.fn(),status=vi.fn(()=>({json}));
 const errorLog={record:vi.fn(),list:vi.fn(),getLifecycle:vi.fn(),updateLifecycle:vi.fn()};
 const host={switchToHttp:()=>({getRequest:()=>({traceId:"integration-trace",route:{path}}),getResponse:()=>({headersSent:false,setHeader,status})})} as unknown as ArgumentsHost;
 new AllExceptionsFilter({info:vi.fn(),error:vi.fn()},errorLog).catch(error,host);
 expect(status).toHaveBeenCalledWith(409);
 expect(json).toHaveBeenCalledWith({error:"conflict",traceId:"integration-trace",code});
 expect(setHeader).toHaveBeenCalledWith("Cache-Control",ENTERPRISE_CACHE_CONTROL);
 expect(errorLog.record).not.toHaveBeenCalled();
});
