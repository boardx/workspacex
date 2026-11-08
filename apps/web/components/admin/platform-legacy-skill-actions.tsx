"use client";
import * as React from "react";
import type { z } from "zod";
import { legacySkillOperations } from "@repo/contracts/ai-catalog-admin";
import {
  scanPlatformLegacySkill,
  submitPlatformLegacySkill,
  reviewPlatformLegacySkill,
} from "@/lib/ai-catalog-admin";
import { aiCatalogFailureText } from "@/lib/ai-catalog-failure";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export function PlatformLegacySkillActions({
  orgId,
  versionId,
  versionState,
  onChanged,
}: {
  orgId: string;
  versionId: string;
  versionState: string | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [scan, setScan] = React.useState<z.infer<
    typeof legacySkillOperations.scan.out
  > | null>(null);
  const [riskAcks, setRiskAcks] = React.useState<string[]>([]);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function act(action: "scan" | "submit" | "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "scan") {
        const out = await scanPlatformLegacySkill(orgId, versionId);
        if (mounted.current) {
          setScan(out);
          setRiskAcks([]);
        }
      } else if (action === "submit") {
        if (!versionState) return;
        await submitPlatformLegacySkill(orgId, versionId, versionState);
        if (mounted.current) onChanged();
      } else {
        await reviewPlatformLegacySkill(orgId, {
          versionId,
          decision: action,
          reason,
          riskAcks,
        });
        if (mounted.current) onChanged();
      }
    } catch (failure) {
      if (mounted.current) setError(aiCatalogFailureText(failure, t));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const id = React.useId();
  return (
    <section
      className="space-y-3 rounded-md border p-3"
      aria-label={t("aiCatalog.legacyActions")}
    >
      <p className="text-12 text-muted-foreground">
        {t("aiCatalog.reviewPolicy")}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act("scan")}
        >
          {t("aiCatalog.scan")}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !versionState}
          onClick={() => void act("submit")}
        >
          {t("aiCatalog.submit")}
        </Button>
      </div>
      {scan ? (
        <div className="space-y-2">
          <p>
            {t(
              scan.verdict === "pass"
                ? "aiCatalog.scanPass"
                : scan.verdict === "reject"
                  ? "aiCatalog.scanReject"
                  : "aiCatalog.scanRisk",
            )}
          </p>
          {scan.findings.map((finding) => (
            <Checkbox
              key={finding.riskItemId}
              label={finding.detail}
              checked={riskAcks.includes(finding.riskItemId)}
              disabled={busy}
              onChange={(event) =>
                setRiskAcks((current) =>
                  event.target.checked
                    ? [...current, finding.riskItemId]
                    : current.filter((id) => id !== finding.riskItemId),
                )
              }
            />
          ))}
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={id}>{t("aiCatalog.reviewReason")}</Label>
        <Input
          id={id}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !reason.trim()}
          onClick={() => void act("approve")}
        >
          {t("aiCatalog.approve")}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !reason.trim()}
          onClick={() => void act("reject")}
        >
          {t("aiCatalog.reject")}
        </Button>
      </div>
    </section>
  );
}
