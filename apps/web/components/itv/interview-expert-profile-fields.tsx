"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from 'react';
import type { InterviewExpertFields } from '@repo/contracts/interview-expert-library';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EXPERT_PROFILE_FIELDS,profileValue,type ExpertProfileDraft,type ExpertProfileKey } from '@/lib/interview-expert-profile';
const profileLabelKeys = {"category": "itv.profile.category", "location": "itv.profile.location", "age": "itv.profile.age", "occupation": "itv.profile.occupation", "goals": "itv.profile.goals", "interests": "itv.profile.interests", "painPoints": "itv.profile.painPoints", "motivations": "itv.profile.motivations", "influences": "itv.profile.influences", "introvertExtrovert": "itv.profile.introvertExtrovert", "analyticalCreative": "itv.profile.analyticalCreative", "busyTimeRich": "itv.profile.busyTimeRich", "serviceValue": "itv.profile.serviceValue", "typicalAdvice": "itv.profile.typicalAdvice"} as const;

export function ExpertProfileInputs({draft,onChange}:{draft:ExpertProfileDraft;onChange:(key:ExpertProfileKey,value:string)=>void}){
 const { t } = useI18n();
 return <fieldset className="space-y-3"><legend className="font-semibold">{t("itv.profile.title")}</legend><p className="text-xs text-muted-foreground">{t("itv.profile.hint")}</p><div className="grid gap-3 sm:grid-cols-2">{EXPERT_PROFILE_FIELDS.map(([key,,kind])=><label key={key} className={`block text-sm ${kind==='list'||kind==='detail'?'sm:col-span-2':''}`}>{t(profileLabelKeys[key])}{kind==='list'||kind==='detail'?<Textarea aria-label={t(profileLabelKeys[key])} value={draft[key]} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>:<Input aria-label={t(profileLabelKeys[key])} value={draft[key]} type={kind==='number'||kind==='trait'?'number':'text'} min={kind==='trait'?1:kind==='number'?0:undefined} max={kind==='trait'?10:undefined} step={kind==='trait'||kind==='number'?1:undefined} maxLength={4000} onChange={event=>onChange(key,event.target.value)}/>}</label>)}</div></fieldset>;
}
export function ExpertProfileDetails({fields}:{fields:InterviewExpertFields}){
 const { t } = useI18n();
 const rows=[[t("itv.field.domains"),fields.domains],[t("itv.field.focus"),fields.focus],[t("itv.field.style"),fields.style],[t("itv.field.bio"),fields.bio],...EXPERT_PROFILE_FIELDS.map(([key,,kind])=>[t(profileLabelKeys[key]),profileValue(fields.profile,key)+(kind==='trait'&&profileValue(fields.profile,key)?' / 10':'')])];
 return <dl className="space-y-3 text-sm">{rows.map(([label,value])=><div key={label} className="space-y-1"><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">{value||t("itv.profile.missing")}</dd></div>)}</dl>;
}
