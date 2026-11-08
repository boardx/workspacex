import { ApiError } from "./api-client";
import type { MessageKey } from "./i18n/messages";
export function aiCatalogFailureText(
  error: unknown,
  t: (key: MessageKey) => string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t("aiCatalog.permissionDenied");
    if (error.status === 404) return t("aiCatalog.notFound");
    switch (error.reasonCode) {
      case "SELF_REVIEW_FORBIDDEN":
        return t("aiCatalog.selfReview");
      case "NO_SECOND_REVIEWER":
        return t("aiCatalog.secondReviewer");
      case "REVIEWER_FUNCTION_MISMATCH":
        return t("aiCatalog.reviewerFunction");
      case "GATE_NOT_PASSED":
      case "SECURITY_SCAN_REJECTED":
        return t("aiCatalog.reviewGate");
      case "CATALOG_MODEL_CHANGE_REQUIRES_VALIDATION":
        return t("aiCatalog.modelChange");
      case "CATALOG_VERSION_CONFLICT":
        return t("aiCatalog.versionConflict");
      case "CATALOG_ENTRY_NOT_DRAFT":
      case "AGENT_NOT_DRAFT":
        return t("aiCatalog.notDraft");
      case "CATALOG_DEPENDENCIES_REQUIRE_INSTALLATION":
      case "AGENT_NOT_TOOLLESS":
        return t("aiCatalog.dependencies");
      case "CATALOG_NAME_CONFLICT":
        return t("aiCatalog.nameConflict");
      case "CATALOG_PUBLISH_REJECTED":
      case "AGENT_VISIBILITY_UNSUPPORTED":
      case "AGENT_NO_EXECUTABLE_DEFINITION":
        return t("aiCatalog.publishRejected");
    }
    if (error.status === 403) return t("aiCatalog.permissionDenied");
  }
  return t("aiCatalog.failed");
}
