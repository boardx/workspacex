import { describe, expect, it } from 'vitest';
import { validateLiveGovernance } from './cn-frozen-release-identity.mjs';
const utc='2026-10-01T15:15:51.887Z',offset='2026-10-01T23:15:51.887+08:00';
function fixture(){
 const env=(id:number,review:boolean)=>({id,created_at:utc,updated_at:utc,protection_rules:review?[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:1}}]}]:[],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}});
 const policies=(branches:string[])=>[...branches.map((name,id)=>({id:id+1,type:'branch',name})),{id:10,type:'tag',name:'cn-prepared-*'}];
 return {promotion:env(1,true),activation:env(2,false),promotionPolicies:policies(['main']),activationPolicies:policies(['main','main-cn']),tagRules:[{id:24316662,source_type:'Repository',source:'boardx/workspacex',target:'tag',enforcement:'active',created_at:utc,updated_at:utc,conditions:{ref_name:{include:['refs/tags/cn-prepared-*'],exclude:[]}},bypass_actors:[],rules:[{type:'update'},{type:'deletion'}]}]};
}
describe('governance timestamp comparison keeps exact instants and raw inputs',()=>{
 it('accepts actual UTC/Shanghai representations for official metadata without changing signed inputs',()=>{
  const signed=fixture(),before=JSON.stringify(signed),live=structuredClone(signed);
  for(const obj of [live.promotion,live.activation,...live.tagRules]){obj.updated_at=offset;obj.created_at=offset;}
  validateLiveGovernance(signed,live);expect(JSON.stringify(signed)).toBe(before);
 });
 for(const value of ['2026-10-01T15:15:51.888Z','invalid',null,undefined,'2026-02-30T15:15:51.887Z','2026-10-01T15:15:51.8871Z'])it('rejects altered or invalid version '+String(value),()=>{
  for(const field of ['promotion','activation','rule']){const signed=fixture(),live=structuredClone(signed);(field==='rule'?live.tagRules[0]:(live as any)[field]).updated_at=value as any;expect(()=>validateLiveGovernance(signed,live)).toThrow();}
 });
 it('normalizes no unrelated timestamp-looking policy values',()=>{
  const signed=fixture(),live=structuredClone(signed);live.promotionPolicies[0].name=offset;expect(()=>validateLiveGovernance(signed,live)).toThrow();
 });
 it('rejects changed created_at and invalid/null metadata',()=>{
  for(const value of ['2026-10-01T15:15:51.888Z','invalid',null]){const signed=fixture(),live=structuredClone(signed);live.tagRules[0].created_at=value as any;expect(()=>validateLiveGovernance(signed,live)).toThrow();}
 });
 it('keeps zero-bypass and complete-rule-set requirements strict',()=>{
  const signed=fixture(),live=structuredClone(signed);(live.tagRules[0].bypass_actors as any).push({actor_id:1});expect(()=>validateLiveGovernance(signed,live)).toThrow();live.tagRules=[];expect(()=>validateLiveGovernance(signed,live)).toThrow();
 });
});
