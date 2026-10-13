import { CreateInterviewCustomExpert, InterviewCustomExpert, InterviewCustomExpertList, type InterviewExpertFields } from '@repo/contracts/interview-expert-library';
import { apiRequest } from './api-client';
export async function loadCustomInterviewExperts(){return InterviewCustomExpertList.parse(await apiRequest('/interviews/digital/expert-library'));}
export async function createCustomInterviewExpert(fields:InterviewExpertFields,requestId:string){return InterviewCustomExpert.parse(await apiRequest('/interviews/digital/expert-library',{method:'POST',body:CreateInterviewCustomExpert.parse({fields,requestId})}));}
