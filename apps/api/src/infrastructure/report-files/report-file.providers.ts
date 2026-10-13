import type { Provider } from '@nestjs/common';
import { DATABASE_PORT, type DatabasePort } from '../../application/ports/database.port';
import { AGENT_RUN_STORE, AGENT_RUN_EXECUTOR, MODEL_CALL_PORT, type AgentRunStore, type AgentRunExecutorPort, type ModelCallPort } from '../../application/agent-run/ports';
import { ID_FACTORY, OBJECT_STORE, type IdFactory, type ObjectStore } from '../../application/artifact/ports';
import { GUIDED_RESEARCH_SESSION_REPOSITORY, type GuidedResearchSessionRepository } from '../../application/research/guided-session-ports';
import { GUIDED_RUNTIME_SERVICE } from '../../application/research/guided-runtime-ports';
import type { GuidedRuntimeService } from '../../application/research/guided-runtime-service';
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from '../../application/identity/ports';
import { DIGITAL_INTERVIEW_REPOSITORY } from '../../application/interview/digital-interview-ports';
import { INTERVIEW_SCOPE_REPOSITORY } from '../../application/interview/ports';
import { INTERVIEW_MARKDOWN_READER } from '../../application/interview/read-interview-markdown';
import { INTERVIEW_REPORT_FILE_SOURCE, InterviewReportFileSource, type InterviewReportFileSourceDeps } from '../../application/interview/interview-report-file-source';
import { ResearchReportFileSource } from '../../application/research/research-report-file-source';
import { REPORT_FILE_SOURCE_RESOLVERS, type ReportFileSourceResolver } from '../../application/report-files/ports';
import { REPORT_FILE_SERVICE, ReportFileService } from '../../application/report-files/service';
import { PgReportFileJobStore } from './pg-job-store';
import { ChatReportFileRuntime } from './chat-report-file-runtime';
import { ReportGeneratedFileValidator } from './file-validator';
import { CHAT_REPOSITORY, type ChatRepository } from '../../application/chat/ports';
import { CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER, ENABLED_SKILL_VERSION_READER, DEFAULT_AGENT_RESOLVER,
  type ChatMessageCommandRepository, type PublishedAgentReader, type ThreadMountedSkillReader, type EnabledSkillVersionReader, type DefaultAgentResolver } from '../../application/chat/message-command-ports';
import { CHAT_ATTACHMENT_COMMAND_REPOSITORY, type AttachmentCommandRepository } from '../../application/chat/upload-attachment';
import { PROVENANCE_WRITER, type ProvenanceWriter } from '../../application/provenance/ports';
import { CLOCK, type Clock } from '../../application/auth/ports';
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from '../../application/chat/generate-thread-title';
import { LOGGER_PORT, structuredErrorLog, type LoggerPort } from '../../application/ports/logger.port';
import { randomUUID } from 'node:crypto';
export const reportFileProviders: Provider[] = [
  { provide: INTERVIEW_REPORT_FILE_SOURCE,
    useFactory: (repo: InterviewReportFileSourceDeps['repo'], scope: InterviewReportFileSourceDeps['scope'], decisions: DecisionIdFactory, reader: InterviewReportFileSourceDeps['reader']) => new InterviewReportFileSource({ repo, scope, decisions, reader }),
    inject: [DIGITAL_INTERVIEW_REPOSITORY, INTERVIEW_SCOPE_REPOSITORY, DECISION_ID_FACTORY, INTERVIEW_MARKDOWN_READER] },
  { provide: REPORT_FILE_SOURCE_RESOLVERS,
    useFactory: (sessions: GuidedResearchSessionRepository, runtime: GuidedRuntimeService, decisions: DecisionIdFactory, interview: InterviewReportFileSource) => [new ResearchReportFileSource({ sessions, runtime, decisions }), interview],
    inject: [GUIDED_RESEARCH_SESSION_REPOSITORY, GUIDED_RUNTIME_SERVICE, DECISION_ID_FACTORY, INTERVIEW_REPORT_FILE_SOURCE] },
  { provide: REPORT_FILE_SERVICE,
    useFactory: (db: DatabasePort, runs: AgentRunStore, model: ModelCallPort, executor: AgentRunExecutorPort, objects: ObjectStore, sources: ReportFileSourceResolver[],
      repo: IdentityRepository, ids: DecisionIdFactory, chat: ChatRepository, commands: ChatMessageCommandRepository, publishedAgents: PublishedAgentReader,
      threadMounts: ThreadMountedSkillReader, enabledSkills: EnabledSkillVersionReader, agents: DefaultAgentResolver, attachments: AttachmentCommandRepository,
      provenance: ProvenanceWriter, artifactIds: IdFactory, clock: Clock, titleModel: ThreadTitleModelConfig, logger: LoggerPort) => {
      const visibility = { repo, ids, chat };
      return new ReportFileService({ store: new PgReportFileJobStore(db), sources, validator: new ReportGeneratedFileValidator(),
        runtime: new ChatReportFileRuntime({ db, runs, executor, agents,
          messages: { ...visibility, commands, publishedAgents, threadMounts, enabledSkills, model, titleModel, log: structuredErrorLog(logger, randomUUID) },
          threads: { ...visibility, provenance, artifactIds },
          attachments: { ...visibility, attachments, store: objects, attachmentIds: artifactIds, clock: { now: () => clock.now().toISOString() } },
        }),
      });
    }, inject: [DATABASE_PORT, AGENT_RUN_STORE, MODEL_CALL_PORT, AGENT_RUN_EXECUTOR, OBJECT_STORE, REPORT_FILE_SOURCE_RESOLVERS,
      IDENTITY_REPOSITORY, DECISION_ID_FACTORY, CHAT_REPOSITORY, CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER,
      THREAD_MOUNTED_SKILL_READER, ENABLED_SKILL_VERSION_READER, DEFAULT_AGENT_RESOLVER, CHAT_ATTACHMENT_COMMAND_REPOSITORY,
      PROVENANCE_WRITER, ID_FACTORY, CLOCK, THREAD_TITLE_MODEL_CONFIG, LOGGER_PORT] },
];
