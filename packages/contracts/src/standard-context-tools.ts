import {z} from 'zod';
import {AnchorKind} from './artifact';
import * as Project from './project';
import {NativeSessionResolveInput} from './native-session-binding';
export const STANDARD_CONTEXT_LIMITS={maxIndexedCandidates:100,maxResults:20,maxReadBytes:4194304,maxTextChars:60000,maxResponseBytes:1048576,deadlineMs:30000} as const;
export const KnowledgeSearchInput=z.object({query:z.string().min(1).max(2000).regex(/\S/),scope:z.enum(['current-files','organization-index']).optional(),projectId:z.string().min(1).max(256).optional(),limit:z.number().int().min(1).max(STANDARD_CONTEXT_LIMITS.maxResults).optional()}).strict();
export const KnowledgeReadInput=z.object({sourceId:z.string().min(1).max(512),versionId:z.string().min(1).max(2048),projectId:z.string().min(1).max(256).optional()}).strict();
export const ProjectListInput=z.object({query:z.string().max(200).optional()}).strict();
export const ProjectReadInput=Project.operations.getProjectOverview.in;
const FileContextCitation=z.object({kind:z.enum(['chat-attachment','canvas-artifact']),sourceRecordId:z.string(),threadId:z.string(),messageId:z.string(),projectId:z.string().nullable()}).strict();
export const IndexedContextCitation=z.object({kind:z.literal('indexed-segment'),segmentId:z.string(),artifactId:z.string(),artifactVersionId:z.string(),projectId:z.string().nullable(),anchor:z.object({kind:AnchorKind,locator:z.string()})}).strict();
export const ContextCitation=z.union([FileContextCitation,IndexedContextCitation]);
export const KnowledgeSearchOutput=z.object({items:z.array(z.object({sourceId:z.string(),versionId:z.string(),title:z.string(),excerpt:z.string(),citationAnchor:ContextCitation})).max(STANDARD_CONTEXT_LIMITS.maxResults),scopeMode:z.enum(['existing-file-retrieval','organization-index-fts']),coverage:z.literal('primary-file-index').optional(),truncated:z.boolean()}).strict();
export const KnowledgeReadOutput=z.object({sourceId:z.string(),sourceVersion:z.string(),content:z.string().max(STANDARD_CONTEXT_LIMITS.maxTextChars),citationAnchor:ContextCitation,accessibleAt:z.string().datetime(),truncated:z.boolean(),contentKind:z.enum(['extracted-source','indexed-segment'])}).strict();
export const ProjectListOutput=z.object({projects:Project.operations.listProjects.out,observedAt:z.string().datetime()}).strict();
export const ProjectReadOutput=z.object({overview:Project.operations.getProjectOverview.out,observedAt:z.string().datetime(),sourceRefs:z.array(z.object({kind:z.literal('project-overview'),projectId:z.string()}))}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const STANDARD_CONTEXT_TOOLS={wx_knowledge_search:{input:KnowledgeSearchInput,output:KnowledgeSearchOutput},wx_knowledge_read:{input:KnowledgeReadInput,output:KnowledgeReadOutput},wx_project_list:{input:ProjectListInput,output:ProjectListOutput},wx_project_read:{input:ProjectReadInput,output:ProjectReadOutput}} as const;
export const StandardContextInvocation=z.discriminatedUnion('toolName',[
 identity.extend({toolName:z.literal('wx_knowledge_search'),toolArgs:KnowledgeSearchInput}).strict(),identity.extend({toolName:z.literal('wx_knowledge_read'),toolArgs:KnowledgeReadInput}).strict(),
 identity.extend({toolName:z.literal('wx_project_list'),toolArgs:ProjectListInput}).strict(),identity.extend({toolName:z.literal('wx_project_read'),toolArgs:ProjectReadInput}).strict(),
]);
