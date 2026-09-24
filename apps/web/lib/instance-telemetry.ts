/**
 * D9 —— 实例「上报设置」的真实 API 薄封装（契约 `instanceTelemetry.operations`）。
 * 类型走 `z.infer`，不重新声明字段名。
 */
import { instanceTelemetry } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const ops = instanceTelemetry.operations;

export type TelemetrySettingsOut = z.infer<typeof ops.getTelemetrySettings.out>;
export type UpdateTelemetryConsentIn = z.infer<typeof ops.updateTelemetryConsent.in>;
export type LastTelemetryReportOut = z.infer<typeof ops.getLastTelemetryReport.out>;

export async function getTelemetrySettings(): Promise<TelemetrySettingsOut> {
  return apiRequest<TelemetrySettingsOut>(ops.getTelemetrySettings.path);
}

export async function updateTelemetryConsent(body: UpdateTelemetryConsentIn): Promise<TelemetrySettingsOut> {
  return apiRequest<TelemetrySettingsOut>(ops.updateTelemetryConsent.path, { method: ops.updateTelemetryConsent.method, body });
}

export async function getLastTelemetryReport(): Promise<LastTelemetryReportOut> {
  return apiRequest<LastTelemetryReportOut>(ops.getLastTelemetryReport.path);
}
