import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { ReportFileRequest, ReportFileSourceKind, ReportFileSourceInfo, operations } from '@repo/contracts/report-files';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { REPORT_FILE_SERVICE, ReportFileError, type ReportFileService } from '../../application/report-files/service';
import { ReportFileSourceError } from '../../application/report-files/ports';
@Controller()
export class ReportFilesController {
  constructor(@Inject(REPORT_FILE_SERVICE) private readonly service: ReportFileService) {}
  private actor(principal: Principal) { assertPrincipal(principal); return { orgId: principal.orgId, userId: principal.userId }; }
  private async invoke<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      const code = error instanceof ReportFileError || error instanceof ReportFileSourceError ? error.code : 'GENERATION_FAILED';
      if (code === 'REPORT_NOT_FOUND') throw new NotFoundException({ reasonCode: code });
      if (code === 'REPORT_CHANGED' || code === 'IDEMPOTENCY_CONFLICT') throw new ConflictException({ reasonCode: code });
      throw new ServiceUnavailableException({ reasonCode: code });
    }
  }
  @Get(operations.source.path)
  async source(@CurrentPrincipal() principal: Principal, @Param('kind') kind: unknown, @Param('id') id: string) {
    const actor = this.actor(principal); const parsed = ReportFileSourceKind.safeParse(kind);
    if (!parsed.success || !id || id.length > 256) throw new BadRequestException();
    const source = await this.invoke(() => this.service.source(actor, { kind: parsed.data, id }));
    return ReportFileSourceInfo.parse({ kind: source.kind, id: source.id, title: source.title, reportVersion: source.reportVersion,
      reportHash: source.reportHash, notices: source.notices });
  }
  @Post(operations.generate.path)
  async generate(@CurrentPrincipal() principal: Principal, @Body() raw: unknown) {
    const actor = this.actor(principal); const parsed = ReportFileRequest.safeParse(raw);
    if (!parsed.success) throw new BadRequestException();
    return this.invoke(() => this.service.start(actor, parsed.data));
  }
  @Get(operations.status.path)
  async status(@CurrentPrincipal() principal: Principal, @Param('jobId') id: string) {
    const actor = this.actor(principal); if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BadRequestException();
    return this.invoke(() => this.service.status(actor, id));
  }
  @Get(operations.download.path)
  async download(@CurrentPrincipal() principal: Principal, @Param('jobId') id: string, @Res() response: Response) {
    const actor = this.actor(principal); if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BadRequestException();
    const { bytes, file } = await this.invoke(() => this.service.download(actor, id));
    response.setHeader('Content-Type', file.mediaType); response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename="report${file.filename.slice(file.filename.lastIndexOf('.'))}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.send(Buffer.from(bytes));
  }
}
