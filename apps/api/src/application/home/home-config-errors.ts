/** 首页配置的业务拒绝码（闭集与契约 `homeConfig.HomeConfigError` 同名子集）。 */
export type HomeConfigReasonCode =
  | "BANNER_COLOR_REQUIRED"
  | "BANNER_ARTIFACT_NOT_OWNED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE";

export class HomeConfigDomainError extends Error {
  constructor(readonly reasonCode: HomeConfigReasonCode) {
    super(reasonCode);
    this.name = "HomeConfigDomainError";
  }
}
