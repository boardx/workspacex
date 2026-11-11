"use client";
import { skillCatalogDescription, skillCatalogTitle } from "@/lib/skill-catalog-copy";
import { aiCatalogFailureText } from "@/lib/ai-catalog-failure";
import * as React from "react";
import { PLATFORM_CATALOG_ORG_ID } from "@repo/contracts/ai-catalog-admin";
import { useSession } from "@/components/session/session-provider";
import { usePlatformAccess } from "@/lib/live-platform-access";
import { useI18n } from "@/lib/i18n/provider";
import {
  createPlatformAiCatalogEntry,
  getPlatformAiCatalogEntry,
  listPlatformAiCatalog,
  setPlatformAiCatalogState,
  updatePlatformAiCatalogEntry,
  type AiCatalogDetail,
  type AiCatalogEntry,
  type AiCatalogKind,
  type AiCatalogPage,
  type AiCatalogWrite,
} from "@/lib/ai-catalog-admin";
import {
  listPlatformOrganizations,
  type OrganizationList,
} from "@/lib/live-platform-organizations";
import { EntityCatalog } from "./entity-catalog";
import { AdminModal } from "./panel";
import { PlatformLegacySkillActions } from "./platform-legacy-skill-actions";
import { AiCatalogDefinitionForm } from "./ai-catalog-definition-form";
import { isAvatarKey } from "@/lib/interview-expert-avatar";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function PlatformAiCatalog({ kind }: { kind: AiCatalogKind }) {
  const { session } = useSession();
  const access = usePlatformAccess(session?.userId ?? null);
  const { t } = useI18n();
  if (!session || !access?.platformOperator)
    return (
      <p className="p-6" role="status">
        {t("aiCatalog.platformDenied")}
      </p>
    );
  return (
    <PlatformCatalogScope
      key={`${session.userId}:${kind}`}
      kind={kind}
      token={session.sessionToken}
    />
  );
}
function PlatformCatalogScope({
  kind,
  token,
}: {
  kind: AiCatalogKind;
  token: string;
}) {
  const { t } = useI18n();
  const [target, setTarget] = React.useState("");
  const [targetLabel, setTargetLabel] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [organizations, setOrganizations] = React.useState<OrganizationList>({
    organizations: [],
    nextCursor: null,
  });
  const [orgBusy, setOrgBusy] = React.useState(false);
  const [page, setPage] = React.useState<AiCatalogPage>({
    entries: [],
    nextCursor: null,
  });
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{
    scope: string;
    saved: boolean;
  } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<AiCatalogDetail | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const generation = React.useRef(0);
  const invalidateRequests = React.useCallback(() => { generation.current++; }, []);
  const orgGeneration = React.useRef(0);
  const invalidateOrganizations = React.useCallback(() => { orgGeneration.current++; }, []);
  const keyOf = (row: AiCatalogEntry) =>
    `${row.orgId}:${row.entityType ?? row.kind}:${row.id}`;
  React.useEffect(() => {
    const request = ++generation.current;
    setStatus("loading");
    setSelected(null);
    setEditing(null);
    setCreating(false);
    setBusy(false);
    setError(null);
    void listPlatformAiCatalog(kind, target || undefined).then(
      (result) => {
        if (request === generation.current) {
          setPage(result);
          setStatus("ready");
        }
      },
      () => {
        if (request === generation.current) {
          setError(t("aiCatalog.failed"));
          setStatus("error");
        }
      },
    );
    return invalidateRequests;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, target, token, refresh]);
  React.useEffect(() => {
    void searchOrganizations(false);
    return invalidateOrganizations;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  async function searchOrganizations(more: boolean) {
    const request = ++orgGeneration.current;
    setOrgBusy(true);
    try {
      const result = await listPlatformOrganizations(
        search,
        more ? (organizations.nextCursor ?? undefined) : undefined,
      );
      if (request === orgGeneration.current)
        setOrganizations((current) =>
          more
            ? {
                ...result,
                organizations: [
                  ...current.organizations,
                  ...result.organizations.filter(
                    (row) =>
                      !current.organizations.some(
                        (old) => old.orgId === row.orgId,
                      ),
                  ),
                ],
              }
            : result,
        );
    } catch (failure) {
      if (request === orgGeneration.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === orgGeneration.current) setOrgBusy(false);
    }
  }
  const moreRequest = React.useRef<number | null>(null);
  async function more() {
    if (!page.nextCursor || busy || moreRequest.current === generation.current) return;
    const cursor = page.nextCursor;
    moreRequest.current = generation.current;
    const request = generation.current;
    setBusy(true);
    try {
      const result = await listPlatformAiCatalog(
        kind,
        target || undefined,
        page.nextCursor,
      );
      if (request === generation.current)
        setPage((current) => ({
          entries: [
            ...current.entries,
            ...result.entries.filter(
              (row) =>
                !current.entries.some((old) => keyOf(old) === keyOf(row)),
            ),
          ],
          nextCursor: result.nextCursor === cursor ? null : result.nextCursor,
        }));
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (moreRequest.current === request) moreRequest.current = null;
      if (request === generation.current) setBusy(false);
    }
  }
  async function edit(row: AiCatalogEntry) {
    const request = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await getPlatformAiCatalogEntry(row);
      if (request === generation.current) setEditing(result);
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function save(definition: AiCatalogWrite) {
    if (busy || (!editing && !target)) return;
    const request = generation.current;
    const current = editing;
    if (current?.definition.kind === "skill-contract") return;
    setBusy(true);
    setError(null);
    try {
      if (current)
        await updatePlatformAiCatalogEntry(current.entry, definition);
      else await createPlatformAiCatalogEntry(target, definition);
      if (request !== generation.current) return;
      setEditing(null);
      setCreating(false);
      setNotice({ scope: `${target}:${kind}`, saved: true });
      setRefresh((n) => n + 1);
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function changeState(
    row: AiCatalogEntry,
    action: "publish" | "disable",
  ) {
    if (busy) return;
    const request = generation.current;
    setBusy(true);
    setError(null);
    try {
      await setPlatformAiCatalogState(row, action);
      if (request === generation.current) {
        setNotice({ scope: `${target}:${kind}`, saved: false });
        setRefresh((n) => n + 1);
      }
    } catch (failure) {
      if (request === generation.current)
        setError(aiCatalogFailureText(failure, t));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`catalog-target-${kind}`}>
            {t("aiCatalog.target")}
          </Label>
          <select
            id={`catalog-target-${kind}`}
            className="h-10 max-w-full rounded-md border bg-background px-3 text-13"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setTargetLabel(
                e.target.selectedOptions[0]?.text ?? e.target.value,
              );
            }}
          >
            <option value="">{t("aiCatalog.allOrganizations")}</option>
            <option value={PLATFORM_CATALOG_ORG_ID}>
              {t("aiCatalog.publicTarget")}
            </option>
            {target &&
            target !== PLATFORM_CATALOG_ORG_ID &&
            !organizations.organizations.some((org) => org.orgId === target) ? (
              <option value={target}>{targetLabel || target}</option>
            ) : null}
            {organizations.organizations
              .filter((org) => org.orgId !== PLATFORM_CATALOG_ORG_ID)
              .map((org) => (
                <option key={org.orgId} value={org.orgId}>
                  {org.name}
                </option>
              ))}
          </select>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void searchOrganizations(false);
          }}
        >
          <Input
            aria-label={t("aiCatalog.organizationSearch")}
            placeholder={t("aiCatalog.organizationSearch")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Button type="submit" variant="outline" disabled={orgBusy}>
            {t("aiCatalog.search")}
          </Button>
          {organizations.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              disabled={orgBusy}
              onClick={() => void searchOrganizations(true)}
            >
              {t("aiCatalog.more")}
            </Button>
          ) : null}
        </form>
      </div>
      <EntityCatalog
        prefix={`platform-${kind}`}
        title={t(
          kind === "agent" ? "aiCatalog.agentTitle" : "aiCatalog.skillTitle",
        )}
        description={t("aiCatalog.platformIntro")}
        status={
          status === "error"
            ? { kind: "error", message: error ?? t("aiCatalog.failed") }
            : { kind: status }
        }
        rows={page.entries}
        keyOf={keyOf}
        searchTextOf={(row) => `${row.name} ${kind === "skill" ? skillCatalogTitle(row.name, row.workSkillId) : ""} ${kind === "skill" ? skillCatalogDescription(row.workSkillId, row.description) ?? "" : row.description} ${row.orgId}`}
        tagsOf={() => []}
        selectedKey={selected}
        onSelect={setSelected}
        onRefresh={() => setRefresh((n) => n + 1)}
        emptyState={<p>{t("aiCatalog.empty")}</p>}
        headerActions={
          <Button
            disabled={!target}
            title={!target ? t("aiCatalog.chooseTarget") : undefined}
            onClick={() => setCreating(true)}
          >
            {t("aiCatalog.new")}
          </Button>
        }
        notices={
          <>
            {error ? <p role="alert">{error}</p> : null}
            {notice?.scope === `${target}:${kind}` ? (
              <p role="status">
                {t(
                  notice.saved ? "aiCatalog.saved" : "aiCatalog.operationDone",
                )}
              </p>
            ) : null}
          </>
        }
        renderCard={(row) => ({
          title: kind === "skill" ? skillCatalogTitle(row.name, row.workSkillId) : row.name,
          description: kind === "skill" ? skillCatalogDescription(row.workSkillId, row.description) : row.description.trim().toLowerCase() === kind ? undefined : row.description || undefined,
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
        detailTitle={(row) => kind === "skill" ? skillCatalogTitle(row.name, row.workSkillId) : row.name}
        detailSubtitle={(row) =>
          row.orgId === PLATFORM_CATALOG_ORG_ID
            ? t("aiCatalog.publicTarget")
            : (organizations.organizations.find(
                (org) => org.orgId === row.orgId,
              )?.name ?? row.orgId)
        }
        renderDetail={(row) => (
          <div className="space-y-4">
            <p>{kind === "skill" ? skillCatalogDescription(row.workSkillId, row.description) : row.description}</p>
            <p>
              {t(
                row.hasDraft && row.published
                  ? "aiCatalog.pendingVersion"
                  : row.published
                    ? "aiCatalog.published"
                    : "aiCatalog.draft",
              )}
            </p>
            <dl className="text-12 text-muted-foreground">
              <dt>{t("aiCatalog.id")}</dt>
              <dd>{row.id}</dd>
              <dt>{t("aiCatalog.version")}</dt>
              <dd>{row.versionId}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void edit(row)}
              >
                {t(
                  row.entityType === "skill-contract"
                    ? "aiCatalog.details"
                    : "aiCatalog.edit",
                )}
              </Button>
              {row.entityType !== "skill-contract" ? (
                <>
                  <Button
                    disabled={
                      busy || !row.enabled || (row.published && !row.hasDraft)
                    }
                    onClick={() => void changeState(row, "publish")}
                  >
                    {t("aiCatalog.publish")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void changeState(row, "disable")}
                  >
                    {t("aiCatalog.disable")}
                  </Button>
                </>
              ) : (
                <p>{t("aiCatalog.legacy")}</p>
              )}
            </div>
          </div>
        )}
      />
      {page.nextCursor ? (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          {t("aiCatalog.more")}
        </Button>
      ) : null}
      {creating || editing ? (
        <AdminModal
          title={t(
            editing?.definition.kind === "skill-contract"
              ? "aiCatalog.details"
              : editing
                ? "aiCatalog.edit"
                : "aiCatalog.new",
          )}
          testid="ai-catalog-editor"
          onClose={() => {
            if (!busy) {
              setCreating(false);
              setEditing(null);
            }
          }}
          width="lg"
        >
          {editing?.definition.kind === "skill-contract" ? (
            <div className="space-y-3">
              <p>{t("aiCatalog.legacy")}</p>
              <p>{editing.definition.input.description}</p>
              {editing.definition.input.versionId ? (
                <PlatformLegacySkillActions
                  key={`${editing.entry.orgId}:${editing.definition.input.versionId}`}
                  orgId={editing.entry.orgId}
                  versionId={editing.definition.input.versionId}
                  versionState={editing.definition.input.versionState ?? null}
                  onChanged={() => {
                    setEditing(null);
                    setNotice({ scope: `${target}:${kind}`, saved: false });
                    setRefresh((value) => value + 1);
                  }}
                />
              ) : null}
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-12">
                {JSON.stringify(editing.definition.input, null, 2)}
              </pre>
            </div>
          ) : (
            <AiCatalogDefinitionForm
              key={editing ? keyOf(editing.entry) : `new:${target}`}
              kind={kind}
              initial={editing?.definition}
              busy={busy}
              onSave={(definition) => void save(definition)}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
            />
          )}
          {error ? (
            <p role="alert" className="p-4">
              {error}
            </p>
          ) : null}
        </AdminModal>
      ) : null}
    </div>
  );
}
