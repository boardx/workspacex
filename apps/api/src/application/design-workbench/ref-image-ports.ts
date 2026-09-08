/**
 * 迭代 13 —— 参考图元信息仓储的 DI 令牌。
 *
 * 与 `project-ports.ts` 的 `DESIGN_PROJECT_REPOSITORY` 同形态：令牌与工厂接口在应用层，
 * PG 实现在 `infrastructure/`，controller 只认这个令牌。
 */
import type { RefImageRepository } from "./ref-images";

export const DESIGN_REF_IMAGE_REPOSITORY = Symbol("DESIGN_REF_IMAGE_REPOSITORY");

export interface DesignRefImageRepositoryFactory {
  forOrg(orgId: string): RefImageRepository;
}
