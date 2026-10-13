import type { Provider } from '@nestjs/common';
import { DATABASE_PORT, type DatabasePort } from '../../application/ports/database.port';
import { AGENT_RUN_STORE, MODEL_CALL_PORT, TOKEN_USAGE_METER, type AgentRunStore, type ModelCallPort, type TokenUsageMeterPort } from '../../application/agent-run/ports';
import { OBJECT_STORE, type ObjectStore } from '../../application/artifact/ports';
import { SKILL_SANDBOX_PORT, type SkillSandboxPort } from '../../application/skill/skill-sandbox-port';
import { ORG_AGENT_MODEL_READER, type OrgAgentModelReader } from '../../application/skill/trial-run-skill';
import { GUIDED_RESEARCH_SESSION_REPOSITORY, type GuidedResearchSessionRepository } from '../../application/research/guided-session-ports';
import { GUIDED_RUNTIME_SERVICE } from '../../application/research/guided-runtime-ports';
import type { GuidedRuntimeService } from '../../application/research/guided-runtime-service';
import { DECISION_ID_FACTORY, type DecisionIdFactory } from '../../application/identity/ports';
import { DIGITAL_INTERVIEW_REPOSITORY } from '../../application/interview/digital-interview-ports';
import { INTERVIEW_SCOPE_REPOSITORY } from '../../application/interview/ports';
import { INTERVIEW_MARKDOWN_READER } from '../../application/interview/read-interview-markdown';
import { INTERVIEW_REPORT_FILE_SOURCE, InterviewReportFileSource, type InterviewReportFileSourceDeps } from '../../application/interview/interview-report-file-source';
import { ResearchReportFileSource } from '../../application/research/research-report-file-source';
import { REPORT_FILE_SOURCE_RESOLVERS, type ReportFileSourceResolver } from '../../application/report-files/ports';
import { REPORT_FILE_SERVICE, ReportFileService } from '../../application/report-files/service';
import { PgReportFileJobStore } from './pg-job-store';
import { RegisteredReportFileSkillRuntime } from './registered-skill-runtime';
import { ReportGeneratedFileValidator } from './file-validator';
import { readSkillTrialRunModelConfig } from '../skill/trial-run-model-config';
export const reportFileProviders: Provider[] = [
  { provide: INTERVIEW_REPORT_FILE_SOURCE,
    useFactory: (repo: InterviewReportFileSourceDeps['repo'], scope: InterviewReportFileSourceDeps['scope'], decisions: DecisionIdFactory, reader: InterviewReportFileSourceDeps['reader']) => new InterviewReportFileSource({ repo, scope, decisions, reader }),
    inject: [DIGITAL_INTERVIEW_REPOSITORY, INTERVIEW_SCOPE_REPOSITORY, DECISION_ID_FACTORY, INTERVIEW_MARKDOWN_READER] },
  { provide: REPORT_FILE_SOURCE_RESOLVERS,
    useFactory: (sessions: GuidedResearchSessionRepository, runtime: GuidedRuntimeService, decisions: DecisionIdFactory, interview: InterviewReportFileSource) => [new ResearchReportFileSource({ sessions, runtime, decisions }), interview],
    inject: [GUIDED_RESEARCH_SESSION_REPOSITORY, GUIDED_RUNTIME_SERVICE, DECISION_ID_FACTORY, INTERVIEW_REPORT_FILE_SOURCE] },
  { provide: REPORT_FILE_SERVICE,
    useFactory: (db: DatabasePort, runs: AgentRunStore, model: ModelCallPort, sandbox: SkillSandboxPort, usage: TokenUsageMeterPort, objects: ObjectStore, orgModel: OrgAgentModelReader, sources: ReportFileSourceResolver[]) => new ReportFileService({
      store: new PgReportFileJobStore(db), objects, sources, validator: new ReportGeneratedFileValidator(),
      runtime: new RegisteredReportFileSkillRuntime({ db, runs, model, sandbox, usage, orgModel, fallback: readSkillTrialRunModelConfig() }),
    }), inject: [DATABASE_PORT, AGENT_RUN_STORE, MODEL_CALL_PORT, SKILL_SANDBOX_PORT, TOKEN_USAGE_METER, OBJECT_STORE, ORG_AGENT_MODEL_READER, REPORT_FILE_SOURCE_RESOLVERS] },
];
