import {operations,SetInput} from "@repo/contracts/organization-core-model";
import type {z} from "zod";
import {apiRequest} from "./api-client";
export type OrgCoreModelState=z.infer<typeof operations.get.out>;
export type OrgCoreModelCandidate=z.infer<typeof operations.candidates.out>[number];
export type OrgCoreModelInput=z.infer<typeof SetInput>;
/** Organization authority comes from the active server session; never from a model or caller payload. */
export const getOrgCoreModel=(signal?:AbortSignal)=>apiRequest<unknown>(operations.get.path,{signal}).then(value=>operations.get.out.parse(value));
export const getOrgCoreModelCandidates=(signal?:AbortSignal)=>apiRequest<unknown>(operations.candidates.path,{signal}).then(value=>operations.candidates.out.parse(value));
export const setOrgCoreModel=(input:OrgCoreModelInput)=>apiRequest<unknown>(operations.set.path,{method:operations.set.method,body:SetInput.parse(input)}).then(value=>operations.set.out.parse(value));
