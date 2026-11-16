import { Body, CanActivate, Controller, ExecutionContext, Get, HttpException, Inject, Injectable, Param, Post, Query, Res, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { files } from "@repo/contracts";
import { AIDT_RAW_FILES_SERVICE } from "../../application/aidt-files/ports";
import { AidtRawFileError, AidtRawFilesService } from "../../application/aidt-files/service";
import { UPLOAD_LIMITS } from "../../domain/files/upload-limits";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
async function respond<T>(work:()=>Promise<T>):Promise<T> {
  try {return await work();} catch(e) {
    if(e instanceof AidtRawFileError) throw new HttpException({reasonCode:e.reasonCode},e.httpStatus);
    // Never leak object keys, tenant ids, database errors or rejected raw bytes.
    throw new HttpException({reasonCode:"DEPENDENCY_UNAVAILABLE"},503);
  }
}
@Injectable()
export class AidtRawUploadGuard implements CanActivate {
  constructor(@Inject(AIDT_RAW_FILES_SERVICE) private readonly service:AidtRawFilesService) {}
  async canActivate(ctx:ExecutionContext) {
    const req=ctx.switchToHttp().getRequest<{principal:Principal;params:{projectId:string}}>();
    assertPrincipal(req.principal);
    await respond(()=>this.service.authorizeUpload({...req.principal,projectId:req.params.projectId}));
    return true;
  }
}
@Controller()
export class AidtRawFilesController {
  constructor(@Inject(AIDT_RAW_FILES_SERVICE) private readonly service:AidtRawFilesService) {}
  @Post(files.operations.uploadArtifact.path)
  @UseGuards(AidtRawUploadGuard)
  @UseInterceptors(FilesInterceptor("files",1,{storage:memoryStorage(),limits:{fileSize:UPLOAD_LIMITS.maxFileSizeBytes,files:1,fields:1,fieldSize:16_384,parts:3}}))
  upload(@CurrentPrincipal() actor:Principal,@Param("projectId") projectId:string,@Body() body:unknown,@UploadedFiles() uploaded?:Express.Multer.File[]) {
    assertPrincipal(actor);
    let raw:unknown;
    try {
      if(!body || typeof body!=="object" || !("meta" in body) || typeof body.meta!=="string" || Object.keys(body).some(key=>key!=="meta")) throw new Error("invalid multipart metadata");
      raw=JSON.parse(body.meta);
    } catch {throw new HttpException({reasonCode:"AIDT_UPLOAD_METADATA_MISMATCH"},422);}
    if(!raw || typeof raw!=="object" || Array.isArray(raw) || ("projectId" in raw && raw.projectId!==projectId)) throw new HttpException({reasonCode:"AIDT_UPLOAD_METADATA_MISMATCH"},422);
    const parsed=files.operations.uploadArtifact.in.safeParse({...raw,projectId});
    if(!parsed.success) throw new HttpException({reasonCode:"AIDT_UPLOAD_METADATA_MISMATCH"},422);
    return respond(()=>this.service.upload({...actor,projectId},parsed.data,(uploaded??[]).map(file=>{const decoded=Buffer.from(file.originalname,"latin1").toString("utf8");const filename=file.originalname===parsed.data.files[0]?.filename?file.originalname:decoded===parsed.data.files[0]?.filename?decoded:file.originalname;return {filename,bytes:file.buffer};})));
  }
  @Get(files.operations.getIngestionRun.path)
  status(@CurrentPrincipal() actor:Principal,@Param("ingestionRunId") runId:string,@Query("projectId") projectId?:string) {
    assertPrincipal(actor);
    return respond(()=>this.service.status(actor,runId,projectId));
  }
  @Get("/ingestion-runs/:ingestionRunId/content")
  async content(@CurrentPrincipal() actor:Principal,@Param("ingestionRunId") runId:string,@Query("projectId") projectId:string|undefined,@Res() res:Response) {
    assertPrincipal(actor);
    if(!projectId) throw new HttpException({reasonCode:"ARTIFACT_NOT_FOUND"},404);
    const row=await respond(()=>this.service.content(actor,runId,projectId));
    res.setHeader("Content-Type",row.mime);
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("X-Content-SHA256",row.sha256);
    res.setHeader("X-Artifact-Id",row.artifactId);
    res.setHeader("X-Artifact-Version-Id",row.versionId);
    res.setHeader("X-Upload-Submitted-By",row.submittedBy);
    res.setHeader("X-Upload-Submitted-At",row.submittedAt);
    res.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    res.send(Buffer.from(row.bytes));
  }
}
