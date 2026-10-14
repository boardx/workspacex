"use client";
import * as React from 'react';
import type { InterviewExpertFields } from '@repo/contracts/interview-expert-library';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EXPERT_PROFILE_FIELDS,profileValue,type ExpertProfileDraft,type ExpertProfileKey } from '@/lib/interview-expert-profile';
export function ExpertProfileInputs({draft,onChange}:{draft:ExpertProfileDraft;onChange:(key:ExpertProfileKey,value:string)=>void}){
 return <fieldset className="space-y-3"><legend className="font-semibold">完整专家资料（选填）</legend><p className="text-xs text-muted-foreground">与内置专家使用相同资料项；列表每行一项。性格为 1–10，分别由内向到外向、分析到创造、忙碌到时间充裕；留空表示未填写。</p>{EXPERT_PROFILE_FIELDS.map(([key,label,kind])=><label key={key} className="block text-sm">{label}{kind==='list'||kind==='detail'?<Textarea aria-label={label} value={draft[key]} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>:<Input aria-label={label} value={draft[key]} type={kind==='number'||kind==='trait'?'number':'text'} min={kind==='trait'?1:kind==='number'?0:undefined} max={kind==='trait'?10:undefined} step={kind==='trait'||kind==='number'?1:undefined} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>}</label>)}</fieldset>;
}
export function ExpertProfileDetails({fields}:{fields:InterviewExpertFields}){
 const rows=[['专业领域',fields.domains],['研究关注',fields.focus],['观点风格',fields.style],['能力简介',fields.bio],...EXPERT_PROFILE_FIELDS.map(([key,label,kind])=>[label,profileValue(fields.profile,key)+(kind==='trait'&&profileValue(fields.profile,key)?' / 10':'')]),['局限与材料边界',fields.limits]];
 return <dl className="space-y-4 text-sm">{rows.map(([label,value])=><div key={label} className="space-y-1"><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">{value||'未填写'}</dd></div>)}</dl>;
}
