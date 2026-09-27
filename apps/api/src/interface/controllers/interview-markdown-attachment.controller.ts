import { BadRequestException,ConflictException,Controller,Inject,NotFoundException,Param,PayloadTooLargeException,Post,Query,Req,Res,ServiceUnavailableException,UnprocessableEntityException,UnsupportedMediaTypeException } from "@nestjs/common";
import multer,{memoryStorage} from "multer";
import type { Request,Response } from "express";
import { interviewMarkdown } from "@repo/contracts";
import { DIGITAL_INTERVIEW_REPOSITORY,type DigitalInterviewRepository } from "../../application/interview/digital-interview-ports";
import { INTERVIEW_SCOPE_REPOSITORY,type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY,type DecisionIdFactory } from "../../application/identity/ports";
import { INTERVIEW_MARKDOWN_READER,type InterviewMarkdownReader } from "../../application/interview/read-interview-markdown";
import { INTERVIEW_MARKDOWN_ATTACHMENTS,InterviewMarkdownAttachmentError,type InterviewMarkdownAttachmentRepository } from "../../application/interview/interview-markdown-attachment.port";
import { OBJECT_STORE,type ObjectStore } from "../../application/artifact/ports";
import { ATTACHMENT_TO_MARKDOWN,type AttachmentToMarkdownPort } from "../../application/chat/attachment-to-markdown.port";
import { importInterviewMarkdownAttachment } from "../../application/interview/import-interview-markdown-attachment";
import { authorizeDigitalInterview } from "../../application/interview/get-digital-interview";
import { ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES } from "../../domain/chat/attachment-extraction";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { NoInterviewAccessError } from "../../application/interview/errors";
import { assertPrincipal,type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { decodeMultipartFilename } from "./chat-attachment.controller";

@Controller("/interviews/digital")
export class InterviewMarkdownAttachmentController {
  constructor(
    @Inject(DIGITAL_INTERVIEW_REPOSITORY) private readonly repo:DigitalInterviewRepository,
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly scope:InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions:DecisionIdFactory,
    @Inject(INTERVIEW_MARKDOWN_READER) private readonly reader:InterviewMarkdownReader,
    @Inject(INTERVIEW_MARKDOWN_ATTACHMENTS) private readonly attachments:InterviewMarkdownAttachmentRepository,
    @Inject(OBJECT_STORE) private readonly store:ObjectStore,
    @Inject(ATTACHMENT_TO_MARKDOWN) private readonly converter:AttachmentToMarkdownPort,
  ) {}
  @Post("/:interviewId/markdown/attachments")
  async upload(@CurrentPrincipal() principal:Principal,@Param("interviewId") interviewId:string,@Query() query:Record<string,unknown>,@Req() req:Request,@Res({passthrough:true}) res:Response) {
    assertPrincipal(principal);
    const deps={repo:this.repo,scope:this.scope,decisions:this.decisions,reader:this.reader,attachments:this.attachments,store:this.store,converter:this.converter};
    const actor={orgId:toOrgId(principal.orgId),interviewId,actorId:principal.userId};
    try {
      // Authorize the interview BEFORE multer consumes or buffers multipart bytes.
      await authorizeDigitalInterview(deps,{...actor,viewerUserId:actor.actorId});
      const versions=interviewMarkdown.GenerateInterviewMarkdown.safeParse({expectedVersion:Number(query.expectedVersion),expectedDocumentVersion:Number(query.expectedDocumentVersion)});
      if(!versions.success) throw new BadRequestException({reasonCode:"DIGITAL_INTERVIEW_INPUT_INVALID"});
      await new Promise<void>((resolve,reject)=>multer({storage:memoryStorage(),limits:{fileSize:ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES,files:1,fields:0}}).single("file")(req,res,error=>error?reject(error):resolve()));
      if(!req.file) throw new BadRequestException({reasonCode:"FILE_REQUIRED"});
      return await importInterviewMarkdownAttachment(deps,{...actor,...versions.data,filename:decodeMultipartFilename(req.file.originalname),mime:req.file.mimetype,bytes:req.file.buffer});
    } catch(error) {
      if(error instanceof NoInterviewAccessError||error instanceof DigitalInterviewWorkflowError&&error.code==="PERMISSION_REVOKED_MIDWAY") throw new NotFoundException();
      if(error instanceof DigitalInterviewWorkflowError) throw new ConflictException({reasonCode:error.code});
      if(error instanceof multer.MulterError) {
        if(error.code==="LIMIT_FILE_SIZE") throw new PayloadTooLargeException({reasonCode:"FILE_TOO_LARGE"});
        throw new BadRequestException({reasonCode:"FILE_UPLOAD_INVALID"});
      }
      if(error instanceof InterviewMarkdownAttachmentError) {
        if(error.code==="FILE_TOO_LARGE") throw new PayloadTooLargeException({reasonCode:error.code});
        if(error.code==="FILE_TYPE_REJECTED"||error.code==="ATTACHMENT_EXTRACTION_UNSUPPORTED") throw new UnsupportedMediaTypeException({reasonCode:error.code});
        if(error.code==="STORAGE_UNAVAILABLE") throw new ServiceUnavailableException({reasonCode:error.code});
        throw new UnprocessableEntityException({reasonCode:error.code});
      }
      throw error;
    }
  }
}
