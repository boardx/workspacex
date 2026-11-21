import {BatchMemberCreditQuota,DEFAULT_MEMBER_MONTHLY_CREDITS,MemberMonthlyCreditLimit,type MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import {EnterpriseCreditPlanRequired,MemberCreditQuotaBelowUsage,type MemberCreditQuotaRepository} from '../../application/auth/member-credit-quota-port';
import {MemberNotFoundError} from '../../application/auth/token-quota-ports';
import {enterpriseCreditPlan,readMemberCreditUsage} from './member-credit-quota';
import {lockTeamFinancialOwner} from './team-financial-owner';
export class PgMemberCreditQuotaRepository implements MemberCreditQuotaRepository {
 constructor(private readonly db:DatabasePort){}
 async readCreditQuotas(orgId:OrgId):Promise<MemberCreditQuotaSnapshot>{
  return this.db.withTenant(orgId,async s=>{
   const enterprise=await enterpriseCreditPlan(s,orgId);
   const month=(await s.query<{month:string}>("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM') AS month")).rows[0]!.month;
   if(!enterprise)return {enterprise,month,defaultMonthlyLimit:DEFAULT_MEMBER_MONTHLY_CREDITS,members:[]};
   const members=(await s.query<{user_id:string;display_name:string;email:string;monthly_limit:string|null}>(`
    SELECT m.user_id,COALESCE(c.display_name,m.user_id) AS display_name,COALESCE(c.email,'') AS email,q.monthly_limit::text FROM org_memberships m
    LEFT JOIN credentials c ON c.user_id=m.user_id
    LEFT JOIN member_credit_quota q ON q.org_id=m.org_id AND q.user_id=m.user_id
    WHERE m.org_id=$1 ORDER BY m.joined_at,m.user_id`,[orgId])).rows;
   const rows=[];
   for(const m of members){
    const usage=await readMemberCreditUsage(s,orgId,m.user_id);
    rows.push({userId:m.user_id,displayName:m.display_name,email:m.email,monthlyLimit:m.monthly_limit===null?DEFAULT_MEMBER_MONTHLY_CREDITS:Number(m.monthly_limit),
     overridden:m.monthly_limit!==null,usedCredits:Number(usage.used)/100,heldCredits:Number(usage.held)/100});
   }
   return {enterprise,month,defaultMonthlyLimit:DEFAULT_MEMBER_MONTHLY_CREDITS,members:rows};
  });
 }
 async setCreditQuota(orgId:OrgId,userId:string,monthlyLimit:number,updatedBy:string){
  MemberMonthlyCreditLimit.parse(monthlyLimit);
  return this.db.withTenant(orgId,async s=>{
   await lockTeamFinancialOwner(s,orgId);
   if(!await enterpriseCreditPlan(s,orgId))throw new EnterpriseCreditPlanRequired();
   if(!(await s.query('SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR KEY SHARE',[orgId,userId])).rows.length)throw new MemberNotFoundError();
   await s.query(`INSERT INTO member_credit_quota(org_id,user_id,monthly_limit,updated_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(org_id,user_id) DO UPDATE SET monthly_limit=EXCLUDED.monthly_limit,updated_by=EXCLUDED.updated_by,updated_at=now()`,[orgId,userId,monthlyLimit,updatedBy]);
   return {monthlyLimit};
  });
 }
 async setCreditQuotas(orgId:OrgId,updates:BatchMemberCreditQuota['updates'],updatedBy:string){
  BatchMemberCreditQuota.parse({updates});
  return this.db.withTenant(orgId,async s=>{
   await lockTeamFinancialOwner(s,orgId);
   if(!await enterpriseCreditPlan(s,orgId))throw new EnterpriseCreditPlanRequired();
   for(const {userId,monthlyLimit} of updates){
    if(!(await s.query('SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR KEY SHARE',[orgId,userId])).rows.length)throw new MemberNotFoundError();
    const {used,held}=await readMemberCreditUsage(s,orgId,userId);
    if(BigInt(monthlyLimit)*100n<used+held)throw new MemberCreditQuotaBelowUsage();
   }
   for(const {userId,monthlyLimit} of updates){
    await s.query(`INSERT INTO member_credit_quota(org_id,user_id,monthly_limit,updated_by) VALUES($1,$2,$3,$4)
     ON CONFLICT(org_id,user_id) DO UPDATE SET monthly_limit=EXCLUDED.monthly_limit,updated_by=EXCLUDED.updated_by,updated_at=now()`,[orgId,userId,monthlyLimit,updatedBy]);
   }
   return {updated:updates.length};
  });
 }
}
