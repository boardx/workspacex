'use strict';
const assert=(v,c)=>{if(!v)throw Error(c)};
const stable=v=>JSON.stringify(v);
const sorted=rows=>rows.map(r=>stable(r)).sort();
const same=(a,b)=>stable(sorted(a))===stable(sorted(b));
const COLUMN_SQL="SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull notnull,pg_get_expr(d.adbin,d.adrelid) default_expr FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.chat_message_attachments'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum";
const CONSTRAINT_SQL="SELECT conname name,contype type,convalidated validated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.chat_message_attachments'::regclass ORDER BY conname";
const POLICY_SQL="SELECT polname name,polcmd cmd,polpermissive permissive,ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE role_oid::regrole::text END FROM unnest(polroles) role_oid ORDER BY role_oid) roles,pg_get_expr(polqual,polrelid) using_expr,pg_get_expr(polwithcheck,polrelid) check_expr FROM pg_policy WHERE polrelid='public.chat_message_attachments'::regclass ORDER BY polname";
const ACL_SQL="SELECT owner.rolname owner,c.relrowsecurity enabled,c.relforcerowsecurity forced,grantee.rolname grantee,grantor.rolname grantor,acl.privilege_type privilege,acl.is_grantable grantable FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee JOIN pg_roles grantor ON grantor.oid=acl.grantor WHERE c.oid='public.chat_message_attachments'::regclass ORDER BY acl.grantee,acl.grantor,acl.privilege_type";
async function capturePendingAttachmentBaseline(client){
 const read=async sql=>(await client.query(sql)).rows;
 const baseline={columns:await read(COLUMN_SQL),constraints:await read(CONSTRAINT_SQL),policies:await read(POLICY_SQL),acl:await read(ACL_SQL)};
 assert(baseline.columns.length>0&&baseline.acl.length>0,'ATTACHMENT_BASELINE_REQUIRED');
 assert(!baseline.columns.some(c=>['uploaded_by','cancelled_at'].includes(c.name)),'ATTACHMENT_PREEXISTING_COLUMNS_REQUIRE_REVIEW');
 assert(!baseline.constraints.some(c=>c.name==='chat_attachment_cancel_pending')&&!baseline.policies.some(p=>p.name==='chat_attachment_delete_pending'),'ATTACHMENT_PREEXISTING_OBJECT_REQUIRE_REVIEW');
 return baseline;
}
const normalize=s=>typeof s==='string'?s.replace(/::(?:text|timestamp with time zone)/g,'').replace(/[\s()]/g,''):s;
async function validatePendingAttachment(client,law,baseline){
 assert(law?.kind==='pending-attachment-cancellation'&&law.relation==='public.chat_message_attachments','ATTACHMENT_LAW_REQUIRED');
 assert(baseline?.columns?.length&&baseline.acl?.length,'ATTACHMENT_BASELINE_REQUIRED');
 const read=async sql=>(await client.query(sql)).rows;
 const columns=await read(COLUMN_SQL),constraints=await read(CONSTRAINT_SQL),policies=await read(POLICY_SQL),acl=await read(ACL_SQL);
 const additions=[{name:'uploaded_by',type:'text',notnull:false,default_expr:null},{name:'cancelled_at',type:'timestamp with time zone',notnull:false,default_expr:null}];
 assert(stable(columns)===stable([...baseline.columns,...additions]),'ATTACHMENT_COLUMN_CLOSURE');
 const check=constraints.filter(c=>c.name==='chat_attachment_cancel_pending');
 assert(check.length===1&&check[0].type==='c'&&check[0].validated===true&&normalize(check[0].definition)==='CHECKcancelled_atISNULLORmessage_idISNULL','ATTACHMENT_CANCEL_CHECK');
 assert(same(constraints.filter(c=>c.name!=='chat_attachment_cancel_pending'),baseline.constraints),'ATTACHMENT_OLD_CONSTRAINT_DRIFT');
 const policy=policies.filter(p=>p.name==='chat_attachment_delete_pending');
 assert(policy.length===1&&policy[0].cmd==='d'&&policy[0].permissive===false&&stable(policy[0].roles)===stable(['app_rw'])&&normalize(policy[0].using_expr)==='message_idISNULL'&&policy[0].check_expr===null,'ATTACHMENT_DELETE_POLICY');
 assert(same(policies.filter(p=>p.name!=='chat_attachment_delete_pending'),baseline.policies),'ATTACHMENT_TENANT_FREEZE_POLICY_DRIFT');
 const extra=acl.filter(a=>!baseline.acl.some(b=>stable(a)===stable(b)));
 assert(baseline.acl.every(b=>acl.some(a=>stable(a)===stable(b)))&&extra.every(a=>a.grantee==='app_rw'&&a.privilege==='DELETE'&&a.grantable===false&&a.grantor===a.owner&&a.owner===baseline.acl[0].owner&&a.enabled===baseline.acl[0].enabled&&a.forced===baseline.acl[0].forced),'ATTACHMENT_ACL_DRIFT');
 assert(acl.some(a=>a.grantee==='app_rw'&&a.privilege==='DELETE'&&!a.grantable),'ATTACHMENT_DELETE_GRANT_MISSING');
 const rows=(await client.query('SELECT count(*)::text total,count(*) FILTER (WHERE uploaded_by IS NOT NULL OR cancelled_at IS NOT NULL)::text changed FROM ONLY public.chat_message_attachments')).rows;
 assert(rows.length===1&&rows[0].changed==='0','ATTACHMENT_LEGACY_PROVENANCE_OR_CANCELLATION_MUTATED');
 return {catalogLawVerified:true,existingCatalogPreserved:true,newLegacyColumnsNull:true,originalColumnMultisetStillRequired:true,liveRuntimeDeleteJourneysVerified:false};
}
const SAFE_CODES=['ATTACHMENT_ACL_DRIFT', 'ATTACHMENT_BASELINE_REQUIRED', 'ATTACHMENT_CANCEL_CHECK', 'ATTACHMENT_COLUMN_CLOSURE', 'ATTACHMENT_DELETE_GRANT_MISSING', 'ATTACHMENT_DELETE_POLICY', 'ATTACHMENT_LAW_REQUIRED', 'ATTACHMENT_LEGACY_PROVENANCE_OR_CANCELLATION_MUTATED', 'ATTACHMENT_OLD_CONSTRAINT_DRIFT', 'ATTACHMENT_PREEXISTING_COLUMNS_REQUIRE_REVIEW', 'ATTACHMENT_PREEXISTING_OBJECT_REQUIRE_REVIEW', 'ATTACHMENT_TENANT_FREEZE_POLICY_DRIFT'];
module.exports={capturePendingAttachmentBaseline,validatePendingAttachment,SAFE_CODES};
