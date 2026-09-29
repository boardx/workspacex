import { BadRequestException, Controller, ForbiddenException, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, PayloadTooLargeException, Post, Res, ServiceUnavailableException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { WHITEBOARD_ASSET_LIMITS, WhiteboardImageMime } from '@repo/contracts/whiteboard-asset';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { WHITEBOARD_IMAGE_ASSETS, WhiteboardImageError, type WhiteboardImageAssets } from '../../application/whiteboard/image-assets';
// Busboy emits partsLimit at the threshold, so allow the closing boundary after one file.
export const BOARD_IMAGE_UPLOAD_LIMITS = { fileSize: WHITEBOARD_ASSET_LIMITS.bytes, files: 1, fields: 0, parts: 2 };
@Controller('whiteboards/:boardId/assets')
export class WhiteboardAssetsController {
  constructor(@Inject(WHITEBOARD_IMAGE_ASSETS) private readonly service: WhiteboardImageAssets) {}
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: BOARD_IMAGE_UPLOAD_LIMITS }))
  async upload(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @UploadedFile() file?: Express.Multer.File) {
    assertPrincipal(p);
    try {
      if (!file) throw new BadRequestException('file_required');
      const mime = WhiteboardImageMime.parse(file.mimetype);
      return await this.service.upload(p, boardId, file.buffer, mime);
    } catch (error) { this.failure(error); }
  }
  @Get(':assetId/content')
  async content(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @Param('assetId') assetId: string, @Res() response: Response) {
    assertPrincipal(p);
    try {
      const result = await this.service.read(p, boardId, assetId);
      response.setHeader('Content-Type', result.metadata.mimeType);
      response.setHeader('Content-Length', result.bytes.byteLength);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Disposition', 'attachment');
      response.send(Buffer.from(result.bytes));
    } catch (error) { this.failure(error); }
  }
  @Post(':assetId/download-grant')
  async issueDownloadGrant(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @Param('assetId') assetId: string) {
    assertPrincipal(p);
    try { return await this.service.issueDownloadGrant(p, boardId, assetId); }
    catch (error) { this.failure(error); }
  }
  @Get('downloads/:token')
  async download(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string, @Param('token') token: string, @Res() response: Response) {
    assertPrincipal(p);
    try {
      const result = await this.service.readWithDownloadGrant(p, boardId, token);
      response.setHeader('Content-Type', result.metadata.mimeType);
      response.setHeader('Content-Length', result.bytes.byteLength);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Disposition', 'attachment');
      response.send(Buffer.from(result.bytes));
    } catch (error) { this.failure(error); }
  }
  private failure(error: unknown): never {
    if (error instanceof WhiteboardImageError) {
      if (error.code === 'NOT_FOUND') throw new NotFoundException();
      if (error.code === 'FORBIDDEN') throw new ForbiddenException();
      if (error.code === 'IMAGE_TOO_LARGE') throw new PayloadTooLargeException();
      if (error.code === 'RATE_LIMITED') throw new HttpException('RATE_LIMITED', 429);
      if (error.code === 'DEPENDENCY_UNAVAILABLE' || error.code === 'INTEGRITY_FAILED') throw new ServiceUnavailableException();
      throw new BadRequestException('INVALID_IMAGE');
    }
    if (error instanceof Error && error.name === 'ZodError') throw new BadRequestException();
    throw error;
  }
}
