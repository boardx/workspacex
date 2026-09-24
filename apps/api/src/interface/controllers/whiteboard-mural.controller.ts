import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import { whiteboardMural as C } from "@repo/contracts";
import { MuralDirectImport } from "../../application/whiteboard/mural-direct-import";
import {
  MuralImportError,
  WHITEBOARD_MURAL_IMPORT,
} from "../../application/whiteboard/mural-ports";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
function failure(error: unknown): never {
  if (!(error instanceof MuralImportError)) throw error;
  const status =
    error.code === "NOT_CONNECTED" || error.code === "REMOTE_UNAUTHORIZED"
      ? 401
      : error.code === "OAUTH_STATE_INVALID"
        ? 403
        : error.code === "REMOTE_RATE_LIMITED"
          ? 429
          : error.code === "REMOTE_TIMEOUT" ||
              error.code === "REMOTE_UNAVAILABLE"
            ? 503
            : error.code === "WIDGET_LIMIT_EXCEEDED" ||
                error.code === "PAYLOAD_TOO_LARGE"
              ? 413
              : 400;
  throw new HttpException({ reasonCode: error.code }, status);
}
@Controller("whiteboards/mural")
export class WhiteboardMuralController {
  constructor(
    @Inject(WHITEBOARD_MURAL_IMPORT) private readonly mural: MuralDirectImport,
  ) {}
  @Get("connection") async connection(@CurrentPrincipal() p: Principal) {
    assertPrincipal(p);
    return this.mural.connection(p);
  }
  @Post("oauth/start") async start(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodBodyPipe(C.StartMuralOAuthInput))
    input: C.StartMuralOAuthInput,
  ) {
    assertPrincipal(p);
    try {
      return await this.mural.start(p, input);
    } catch (error) {
      failure(error);
    }
  }
  @Post("oauth/callback") async callback(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodBodyPipe(C.CompleteMuralOAuthInput))
    input: C.CompleteMuralOAuthInput,
  ) {
    assertPrincipal(p);
    try {
      return C.CompleteMuralOAuthResult.parse(
        await this.mural.callback(p, input.state, input.code),
      );
    } catch (error) {
      failure(error);
    }
  }
  @Get("workspaces") async workspaces(
    @CurrentPrincipal() p: Principal,
    @Query() query: unknown,
  ) {
    assertPrincipal(p);
    try {
      return await this.mural.listWorkspaces(p, query);
    } catch (error) {
      failure(error);
    }
  }
  @Get("murals") async murals(
    @CurrentPrincipal() p: Principal,
    @Query() query: unknown,
  ) {
    assertPrincipal(p);
    try {
      return await this.mural.listMurals(p, query);
    } catch (error) {
      failure(error);
    }
  }
  @Post("imports/preview") async preview(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodBodyPipe(C.PreviewMuralInput)) input: C.PreviewMuralInput,
  ) {
    assertPrincipal(p);
    try {
      return await this.mural.preview(p, input);
    } catch (error) {
      failure(error);
    }
  }
  @Delete("connection") async disconnect(@CurrentPrincipal() p: Principal) {
    assertPrincipal(p);
    try {
      return await this.mural.disconnect(p);
    } catch (error) {
      failure(error);
    }
  }
}
