import type {z} from 'zod';
import type {OrgId} from '../../domain/org-id';
import {STANDARD_CONTEXT_TOOLS as C,ProjectListOutput,ProjectReadOutput} from '@repo/contracts/standard-context-tools';
import {listProjects,type ListProjectsDeps} from '../project/list-projects';
import {getProjectOverview,type GetProjectOverviewDeps} from '../project/get-project-overview';
export interface TrustedContextActor {readonly orgId:OrgId;readonly userId:string;readonly threadId:string;readonly projectId:string|null;}
export interface StandardKnowledgeSource {
 search(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_search.input>):Promise<z.infer<typeof C.wx_knowledge_search.output>>;
 read(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_read.input>):Promise<z.infer<typeof C.wx_knowledge_read.output>>;
}
export const STANDARD_CONTEXT_SERVICE=Symbol('StandardContextService');
export class StandardContextService {
 constructor(private lists:ListProjectsDeps,private overview:GetProjectOverviewDeps,private knowledge:StandardKnowledgeSource){}
 async projects(actor:TrustedContextActor,input:z.infer<typeof C.wx_project_list.input>){
  const projects=await listProjects(this.lists,{orgId:actor.orgId,actorId:actor.userId});
  return ProjectListOutput.parse({projects:input.query?projects.filter(p=>p.name.toLowerCase().includes(input.query!.toLowerCase())):projects,observedAt:new Date().toISOString()});
 }
 async project(actor:TrustedContextActor,input:z.infer<typeof C.wx_project_read.input>){
  return ProjectReadOutput.parse({overview:await getProjectOverview(this.overview,{orgId:actor.orgId,userId:actor.userId,projectId:input.projectId}),observedAt:new Date().toISOString(),sourceRefs:[{kind:'project-overview',projectId:input.projectId}]});
 }
 search(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_search.input>){return this.knowledge.search(actor,input);}
 read(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_read.input>){return this.knowledge.read(actor,input);}
}
