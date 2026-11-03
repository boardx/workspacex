import type {TenantSession} from "../../application/ports/database.port";
import {lockCapacityEpoch} from "../org-capacity/pg-commercial-capacity";
/** Financial recovery survives org deletion. Rights still require an existing writable canonical org. */
export async function lockTeamFinancialOwner(s:TenantSession,orgId:string):Promise<boolean>{
 await lockCapacityEpoch(s);
 const row=(await s.query<{writable:boolean}>("SELECT id,kernel_org_is_writable(id) AS writable FROM organizations WHERE id=$1 FOR UPDATE",[orgId])).rows[0];
 return row?.writable===true;
}
