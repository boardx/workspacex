"use client";
import * as React from 'react';
import type { InterviewExpertFields } from '@repo/contracts/interview-expert-library';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EXPERT_PROFILE_FIELDS,profileValue,type ExpertProfileDraft,type ExpertProfileKey } from '@/lib/interview-expert-profile';
export function ExpertProfileInputs({draft,onChange}:{draft:ExpertProfileDraft;onChange:(key:ExpertProfileKey,value:string)=>void}){
 return <fieldset className="space-y-3"><legend className="font-semibold">完整专家资料（选填）</legend><p className="text-xs text-muted-foreground">列表每行一项；性格评分 1–10，方向见字段名称。留空表示未填写。</p><div className="grid gap-3 sm:grid-cols-2">{EXPERT_PROFILE_FIELDS.map(([key,label,kind])=><label key={key} className={`block text-sm ${kind==='list'||kind==='detail'?'sm:col-span-2':''}`}>{label}{kind==='list'||kind==='detail'?<Textarea aria-label={label} value={draft[key]} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>:<Input aria-label={label} value={draft[key]} type={kind==='number'||kind==='trait'?'number':'text'} min={kind==='trait'?1:kind==='number'?0:undefined} max={kind==='trait'?10:undefined} step={kind==='trait'||kind==='number'?1:undefined} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>}</label>)}</div></fieldset>;
}
export function ExpertProfileDetails({fields}:{fields:InterviewExpertFields}){
 const rows=[['专业领域',fields.domains],['研究关注',fields.focus],['观点风格',fields.style],['能力简介',fields.bio],...EXPERT_PROFILE_FIELDS.map(([key,label,kind])=>[label,profileValue(fields.profile,key)+(kind==='trait'&&profileValue(fields.profile,key)?' / 10':'')])];
 return <dl className="space-y-3 text-sm">{rows.map(([label,value])=><div key={label} className="space-y-1"><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">{value||'未填写'}</dd></div>)}</dl>;
}
