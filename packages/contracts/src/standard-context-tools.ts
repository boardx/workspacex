import {z} from 'zod';
import {QueryTask,RetrievalChannelPlan} from './context-pack';
import {AnchorKind} from './artifact';
import * as Project from './project';
import {NativeSessionResolveInput} from './native-session-binding';
import {CitationAnchorKind} from './chat';
export const STANDARD_CONTEXT_LIMITS={maxIndexedCandidates:100,maxResults:20,maxReadBytes:4194304,maxTextChars:60000,maxResponseBytes:1048576,deadlineMs:30000} as const;
export const KnowledgeSearchInput=z.object({query:z.string().min(1).max(2000).regex(/\S/),scope:z.enum(['current-files','organization-index','organization-hybrid']).optional(),projectId:z.string().min(1).max(256).optional(),queryTask:QueryTask.optional(),limit:z.number().int().min(1).max(STANDARD_CONTEXT_LIMITS.maxResults).optional()}).strict();
export const KnowledgeReadInput=z.object({sourceId:z.string().min(1).max(512),versionId:z.string().min(1).max(2048),projectId:z.string().min(1).max(256).optional()}).strict();
export const ProjectListInput=z.object({query:z.string().max(200).optional()}).strict();
export const ProjectReadInput=Project.operations.getProjectOverview.in;
const FileContextCitation=z.object({kind:z.enum(['chat-attachment','canvas-artifact']),sourceRecordId:z.string(),threadId:z.string(),messageId:z.string(),projectId:z.string().nullable()}).strict();
export const IndexedContextCitation=z.object({kind:z.literal('indexed-segment'),segmentId:z.string(),artifactId:z.string(),artifactVersionId:z.string(),projectId:z.string().nullable(),anchor:z.object({kind:AnchorKind,locator:z.string()})}).strict();
export const ContextCitation=z.union([FileContextCitation,IndexedContextCitation]);
export const KnowledgeSearchOutput=z.object({items:z.array(z.object({sourceId:z.string(),versionId:z.string(),title:z.string(),excerpt:z.string(),citationAnchor:ContextCitation})).max(STANDARD_CONTEXT_LIMITS.maxResults),scopeMode:z.enum(['existing-file-retrieval','organization-index-fts','organization-index-hybrid']),coverage:z.literal('primary-file-index').optional(),retrievalPlan:z.array(RetrievalChannelPlan).optional(),truncated:z.boolean()}).strict();
export const KnowledgeReadOutput=z.object({sourceId:z.string(),sourceVersion:z.string(),content:z.string().max(STANDARD_CONTEXT_LIMITS.maxTextChars),citationAnchor:ContextCitation,accessibleAt:z.string().datetime(),truncated:z.boolean(),contentKind:z.enum(['extracted-source','indexed-segment']),title:z.string().max(512).optional()}).strict();
export const ProjectListOutput=z.object({projects:Project.operations.listProjects.out,observedAt:z.string().datetime()}).strict();
export const ProjectReadOutput=z.object({overview:Project.operations.getProjectOverview.out,observedAt:z.string().datetime(),sourceRefs:z.array(z.object({kind:z.literal('project-overview'),projectId:z.string()}))}).strict();
/**
 * #4227 —— `wx_cite`：模型声明「这条回答引用了哪几处来源」。服务端逐条重读（与 `wx_knowledge_read`
 * 同一条授权 + 版本校验），通过的才记到本次 run 上，写回时编号 1..n 落进 `chat_citations`。
 * 锚点三形态与 `chat.CitationAnchorKind` 同源（不留第二份枚举）。
 */
export const CiteAnchor=z.object({kind:CitationAnchorKind,page:z.number().int().positive().optional(),range:z.string().min(1).max(200).optional(),messageId:z.string().min(1).max(256).optional()}).strict();
export const CiteInput=z.object({citations:z.array(z.object({sourceId:z.string().min(1).max(512),versionId:z.string().min(1).max(2048),projectId:z.string().min(1).max(256).optional(),anchor:CiteAnchor.optional(),quote:z.string().min(1).max(500).optional()}).strict()).min(1).max(STANDARD_CONTEXT_LIMITS.maxResults)}).strict();
export const CiteRejectReason=z.enum(['source_not_visible','anchor_invalid','quote_not_found','run_not_active']);
export const CiteOutput=z.object({accepted:z.array(z.object({index:z.number().int().positive(),sourceId:z.string(),sourceFullName:z.string()})),rejected:z.array(z.object({sourceId:z.string(),reason:CiteRejectReason}))}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const STANDARD_CONTEXT_TOOLS={wx_knowledge_search:{input:KnowledgeSearchInput,output:KnowledgeSearchOutput},wx_knowledge_read:{input:KnowledgeReadInput,output:KnowledgeReadOutput},wx_project_list:{input:ProjectListInput,output:ProjectListOutput},wx_project_read:{input:ProjectReadInput,output:ProjectReadOutput},wx_cite:{input:CiteInput,output:CiteOutput}} as const;
export const StandardContextInvocation=z.discriminatedUnion('toolName',[
 identity.extend({toolName:z.literal('wx_knowledge_search'),toolArgs:KnowledgeSearchInput}).strict(),identity.extend({toolName:z.literal('wx_knowledge_read'),toolArgs:KnowledgeReadInput}).strict(),
 identity.extend({toolName:z.literal('wx_project_list'),toolArgs:ProjectListInput}).strict(),identity.extend({toolName:z.literal('wx_project_read'),toolArgs:ProjectReadInput}).strict(),
 identity.extend({toolName:z.literal('wx_cite'),toolArgs:CiteInput}).strict(),
]);
