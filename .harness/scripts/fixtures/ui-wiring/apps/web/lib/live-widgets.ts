import { widgets } from "@repo/contracts";
import { apiRequest } from "./api-client";

export async function listWidgets() {
  return apiRequest(widgets.operations.listWidgets.path);
}
