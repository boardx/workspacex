import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, PayloadTooLargeException, Post, Res, ServiceUnavailableException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { WHITEBOARD_FILE_LIMITS, WhiteboardFileMetadata } from '@repo/contracts/whiteboard-file';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { WHITEBOARD_FILE_ASSETS, WhiteboardFileAssets, WhiteboardFileError } from '../../application/whiteboard/file-assets';

@Controller('whiteboards/:boardId/files')
export class WhiteboardFilesController {
  constructor(@Inject(WHITEBOARD_FILE_ASSETS) private readonly service: WhiteboardFileAssets) {}
  @Post()
  // Busboy raises partsLimit at equality; files/fields still allow only one of each.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: WHITEBOARD_FILE_LIMITS.bytes, files: 1, fields: 1, fieldSize: 1024, parts: 3 } }))
  async upload(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @UploadedFile() file?: Express.Multer.File, @Body() fields: Record<string, unknown> = {}) {
    assertPrincipal(p);
    try {
      if (!file) throw new BadRequestException('file_required');
      if (Object.keys(fields).some(key => key !== 'fileName')) throw new BadRequestException('INVALID_FILE');
      if (Object.hasOwn(fields, 'fileName')) {
        const explicitName = WhiteboardFileMetadata.shape.fileName.safeParse(fields.fileName);
        if (!explicitName.success) throw new BadRequestException('INVALID_FILE');
        return await this.service.upload(p, boardId, file.buffer, explicitName.data, file.mimetype);
      }
      let fileName = file.originalname;
      const latin1 = Buffer.from(fileName, 'latin1');
      // Busboy reads browser UTF-8 filename bytes as Latin1; decode once, only when lossless.
      if (latin1.toString('latin1') === fileName) {
        try { fileName = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(latin1); }
        catch { /* Invalid UTF-8 may be a genuine Latin1 filename. Keep the original. */ }
      }
      return await this.service.upload(p, boardId, file.buffer, fileName, file.mimetype);
    } catch (error) { this.failure(error); }
  }
  @Get(':assetId/content')
  async content(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @Param('assetId') assetId: string, @Res() response: Response) {
    assertPrincipal(p);
    try {
      const result = await this.service.read(p, boardId, assetId);
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Length', result.bytes.byteLength);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const encodedName = encodeURIComponent(result.metadata.fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      response.send(Buffer.from(result.bytes));
    } catch (error) { this.failure(error); }
  }
  private failure(error: unknown): never {
    if (error instanceof WhiteboardFileError) {
      if (error.code === 'NOT_FOUND') throw new NotFoundException();
      if (error.code === 'FORBIDDEN') throw new ForbiddenException();
      if (error.code === 'FILE_TOO_LARGE') throw new PayloadTooLargeException();
      if (error.code === 'DEPENDENCY_UNAVAILABLE' || error.code === 'INTEGRITY_FAILED') throw new ServiceUnavailableException();
      throw new BadRequestException('INVALID_FILE');
    }
    if (error instanceof Error && error.name === 'ZodError') throw new BadRequestException();
    throw error;
  }
}
