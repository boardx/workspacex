import { InterviewExpertProfile, type InterviewExpertFields } from '@repo/contracts/interview-expert-library';
import type { InterviewPersona } from './interview-personas/persona-library';

import { EXPERT_PROFILE_FIELDS, type ExpertProfileKey } from "./interview-expert-profile-fields";
export { EXPERT_PROFILE_FIELDS, type ExpertProfileKey } from "./interview-expert-profile-fields";

export type ExpertProfileDraft = Record<ExpertProfileKey,string>;
export const emptyExpertProfile = ():ExpertProfileDraft => Object.fromEntries(EXPERT_PROFILE_FIELDS.map(([key])=>[key,''])) as ExpertProfileDraft;
export function profileValue(profile:InterviewExpertProfile|undefined,key:ExpertProfileKey):string {
 const field=EXPERT_PROFILE_FIELDS.find(([name])=>name===key)!;
 const value=field[2]==='trait'?profile?.personalityTraits?.[key as keyof NonNullable<InterviewExpertProfile['personalityTraits']>]:profile?.[key as keyof InterviewExpertProfile];
 return Array.isArray(value)?value.join('\n'):value===undefined?'':String(value);
}
export function parseExpertProfileDraft(draft:ExpertProfileDraft):InterviewExpertProfile|undefined {
 const values:Record<string,unknown>={};const traits:Record<string,number>={};
 for(const [key,,kind] of EXPERT_PROFILE_FIELDS){
  const value=draft[key].trim();if(!value)continue;
  if(kind==='trait')traits[key]=Number(value);
  else values[key]=kind==='number'?Number(value):kind==='list'?value.split('\n').map(item=>item.trim()).filter(Boolean):value;
 }
 if(Object.keys(traits).length)values.personalityTraits=traits;
 return Object.keys(values).length?InterviewExpertProfile.parse(values):undefined;
}
export const BUILTIN_EXPERT_LIMITS='静态模拟画像，背景与建议未经独立验证，不作为真人证据。';
export function personaExpertFields(persona:InterviewPersona):InterviewExpertFields {
 return {name:persona.name,role:persona.specialty,domains:persona.category,
  focus:persona.goals.join('\n'),style:'',bio:persona.bio,limits:BUILTIN_EXPERT_LIMITS,
  profile:{category:persona.category,location:persona.personality.locations,age:persona.personality.age,occupation:persona.personality.occupation,
   goals:persona.goals,interests:persona.interests,painPoints:persona.pain_points,motivations:persona.motivations,influences:persona.influences,
   personalityTraits:{introvertExtrovert:persona.personality_traits.introvert_extrovert,analyticalCreative:persona.personality_traits.analytical_creative,busyTimeRich:persona.personality_traits.busy_time_rich},
   serviceValue:persona.service_value,typicalAdvice:persona.typical_advice}};
}
