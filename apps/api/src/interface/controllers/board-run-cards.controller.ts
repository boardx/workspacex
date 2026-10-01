/**
 * CT10 / UC-WC-7 —— `GET /board/workflow-run-cards`（契约 work-content.operations.listBoardRunCards）。
 * 路径与载荷单源自 `@repo/contracts/work-content`；读权限过滤在应用层（listBoardRunCards → WF03 canView）。
 */
import { Controller, Get, HttpException, Inject, Query } from "@nestjs/common";
import { operations as workContentOps } from "@repo/contracts/work-content";
import { BOARD_RUN_CARDS_DEPS, listBoardRunCards, type ListBoardRunCardsDeps } from "../../application/board/list-board-run-cards";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

const OP = workContentOps.listBoardRunCards;

@Controller()
export class BoardRunCardsController {
  constructor(@Inject(BOARD_RUN_CARDS_DEPS) private readonly deps: ListBoardRunCardsDeps) {}

  @Get(OP.path)
  async list(@CurrentPrincipal() principal: Principal, @Query() raw: unknown) {
    assertPrincipal(principal);
    const parsed = OP.in.safeParse(raw ?? {});
    if (!parsed.success) throw new HttpException({ reasonCode: "bad_request" }, 400);
    const out = await listBoardRunCards(this.deps, {
      orgId: principal.orgId,
      viewerUserId: principal.userId,
      projectId: parsed.data.projectId ?? null,
    });
    return OP.out.parse(out);
  }
}
