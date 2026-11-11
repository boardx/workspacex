"use client";
import { skillCatalogDescription, skillCatalogTitle } from "@/lib/skill-catalog-copy";
import { aiCatalogFailureText } from "@/lib/ai-catalog-failure";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import {
  enablePublicAiCatalog,
  listPublicAiCatalog,
  type AiCatalogEntry,
  type AiCatalogKind,
  type AiCatalogPage,
} from "@/lib/ai-catalog-admin";
import { EntityCatalog } from "./entity-catalog";
import { isAvatarKey } from "@/lib/interview-expert-avatar";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function PublicAiCatalog({ kind }: { kind: AiCatalogKind }) {
  const { session, identity } = useSession();
  if (!session) return null;
  return (
    <PublicCatalogScope
      key={`${session.currentOrgId}:${session.userId}:${kind}`}
      orgId={session.currentOrgId}
      token={session.sessionToken}
      kind={kind}
      canEnable={identity?.orgRole === "admin"}
    />
  );
}
function PublicCatalogScope({
  orgId,
  token,
  kind,
  canEnable,
}: {
  orgId: string;
  token: string;
  kind: AiCatalogKind;
  canEnable: boolean;
}) {
  const { t } = useI18n();
  const [page, setPage] = React.useState<AiCatalogPage>({
    entries: [],
    nextCursor: null,
  });
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const generation = React.useRef(0);
  const invalidateRequests = React.useCallback(() => { generation.current++; }, []);
  const keys = React.useRef(new Map<string, string>());
  const keyOf = (row: AiCatalogEntry) =>
    `${row.orgId}:${row.entityType ?? row.kind}:${row.id}`;
  React.useEffect(() => {
    const request = ++generation.current;
    setStatus("loading");
    setSelected(null);
    setError(null);
    setNotice(false);
    setBusy(false);
    void listPublicAiCatalog(orgId, kind).then(
      (result) => {
        if (generation.current === request) {
          setPage(result);
          setStatus("ready");
        }
      },
      () => {
        if (generation.current === request) {
          setError(t("aiCatalog.failed"));
          setStatus("error");
        }
      },
    );
    return invalidateRequests;
    // Locale changes do not refetch data or invalidate pending writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, token, kind, refresh]);
  async function more() {
    if (!page.nextCursor || busy) return;
    const request = generation.current;
    setBusy(true);
    try {
      const next = await listPublicAiCatalog(orgId, kind, page.nextCursor);
      if (request === generation.current)
        setPage((current) => ({
          entries: [
            ...current.entries,
            ...next.entries.filter(
              (row) =>
                !current.entries.some(
                  (existing) => keyOf(existing) === keyOf(row),
                ),
            ),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function enable(row: AiCatalogEntry) {
    if (!canEnable || !row.versionId || row.enabled || busy) return;
    const request = generation.current;
    setBusy(true);
    setError(null);
    const operation = `${keyOf(row)}:${row.versionId}`;
    let idempotencyKey = keys.current.get(operation);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(operation, idempotencyKey);
    }
    try {
      await enablePublicAiCatalog(orgId, row, idempotencyKey);
      if (request !== generation.current) return;
      setPage((current) => ({
        ...current,
        entries: current.entries.map((entry) =>
          keyOf(entry) === keyOf(row) ? { ...entry, enabled: true } : entry,
        ),
      }));
      setNotice(true);
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <EntityCatalog
        prefix={`public-${kind}`}
        title={t(
          kind === "agent" ? "aiCatalog.agentTitle" : "aiCatalog.skillTitle",
        )}
        description={t("aiCatalog.publicIntro")}
        status={
          status === "error"
            ? { kind: "error", message: error ?? t("aiCatalog.failed") }
            : { kind: status }
        }
        rows={page.entries}
        keyOf={keyOf}
        searchTextOf={(row) => `${row.name} ${kind === "skill" ? skillCatalogTitle(row.name) : ""} ${kind === "skill" ? skillCatalogDescription(row.name, row.description) ?? "" : row.description}`}
        tagsOf={() => []}
        selectedKey={selected}
        onSelect={setSelected}
        onRefresh={() => setRefresh((n) => n + 1)}
        emptyState={<p>{t("aiCatalog.empty")}</p>}
        notices={
          <>
            {error && status !== "error" ? <p role="alert">{error}</p> : null}
            {notice ? <p role="status">{t("aiCatalog.enableDone")}</p> : null}
          </>
        }
        renderCard={(row) => ({
          title: kind === "skill" ? skillCatalogTitle(row.name) : row.name,
          description: kind === "skill" ? skillCatalogDescription(row.name, row.description) : row.description || kind,
          leading:
            row.avatarUrl || isAvatarKey(row.avatarKey ?? null) ? (
              <Avatar
                initials={row.name.slice(0, 1)}
                src={row.avatarUrl}
                avatarKey={row.avatarKey}
                className="h-16 w-16"
              />
            ) : undefined,
        })}
        detailTitle={(row) => kind === "skill" ? skillCatalogTitle(row.name) : row.name}
        renderDetail={(row) => (
          <div className="space-y-4">
            <p>{kind === "skill" ? skillCatalogDescription(row.name, row.description) : row.description}</p>
            <dl className="text-12 text-muted-foreground">
              <dt>{t("aiCatalog.version")}</dt>
              <dd>{row.versionId}</dd>
            </dl>
            {row.enabled ? (
              <p>{t("aiCatalog.enabled")}</p>
            ) : canEnable ? (
              <Button
                disabled={busy || !row.versionId}
                onClick={() => void enable(row)}
              >
                {t(busy ? "aiCatalog.enabling" : "aiCatalog.enable")}
              </Button>
            ) : (
              <p>{t("aiCatalog.adminEnable")}</p>
            )}
          </div>
        )}
      />
      {page.nextCursor ? (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          {t("aiCatalog.more")}
        </Button>
      ) : null}
    </>
  );
}
