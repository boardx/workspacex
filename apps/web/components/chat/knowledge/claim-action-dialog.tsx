"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { graphObjectKindLabel } from "@/lib/knowledge-graph-copy";
import { claimTriState, type KgClaim, type KgHumanAction, type KgObject } from "@repo/contracts/chat-knowledge-graph";

export type ClaimDialogKind = "revise" | "revoke" | "contest" | "merge" | "split" | "rename";

/**
 * 单条记忆的编辑对话框（uc-18-3 R3 / R4，F10）—— 收集动作需要的输入，再交给 `onApply`。
 *
 * - `onApply` 返回 `true` = 服务端已接受，对话框关掉；`false` = 失败（面板顶部显示人话），
 *   对话框留着，用户改了还能再提交。
 * - 「忘掉」是危险动作：二次确认 + 影响范围说明（硬规则 ⑦）。
 * - 合并 / 拆分 / 改名作用在「相关的人和事」上：候选取这一条关联的人和事（`aboutObjectIds`）。
 */
export function ClaimActionDialog({
  kind,
  claim,
  claims,
  objects,
  onApply,
  onClose,
}: {
  kind: ClaimDialogKind;
  claim: KgClaim;
  claims: readonly KgClaim[];
  objects: readonly KgObject[];
  onApply: (action: KgHumanAction) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const submit = async (action: KgHumanAction) => {
    setBusy(true);
    const ok = await onApply(action);
    setBusy(false);
    if (ok) onClose();
  };
  // 按这一条自己列出的顺序（第一个通常是主角），跳过读模型里已经不在的
  const about = claim.aboutObjectIds
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is KgObject => o !== undefined);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid={`kg-${kind === "revoke" ? "delete-confirm" : `${kind}-dialog`}-${claim.id}`}>
        {kind === "revise" ? (
          <ReviseBody claim={claim} busy={busy} onSubmit={submit} onCancel={onClose} />
        ) : kind === "revoke" ? (
          <RevokeBody claim={claim} busy={busy} onSubmit={submit} onCancel={onClose} />
        ) : kind === "contest" ? (
          <ContestBody claim={claim} claims={claims} busy={busy} onSubmit={submit} onCancel={onClose} />
        ) : kind === "merge" ? (
          <MergeBody claim={claim} about={about} objects={objects} busy={busy} onSubmit={submit} onCancel={onClose} />
        ) : kind === "split" ? (
          <SplitBody claim={claim} about={about} claims={claims} busy={busy} onSubmit={submit} onCancel={onClose} />
        ) : (
          <RenameBody claim={claim} about={about} busy={busy} onSubmit={submit} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  claim: KgClaim;
  busy: boolean;
  onSubmit: (action: KgHumanAction) => Promise<void>;
  onCancel: () => void;
}

function Footer({
  id, busy, disabled, label, destructive = false, onSubmit, onCancel, testPrefix,
}: {
  id: string;
  busy: boolean;
  disabled: boolean;
  label: string;
  destructive?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  testPrefix: string;
}) {
  const { t } = useI18n();
  return (
    <DialogFooter>
      <Button variant="outline" size="sm" onClick={onCancel} data-testid={`kg-${testPrefix}-cancel-${id}`}>
        {t("common.cancel")}
      </Button>
      <Button
        variant={destructive ? "destructive" : "primary"}
        size="sm"
        disabled={disabled || busy}
        onClick={onSubmit}
        data-testid={testPrefix === "delete" ? `kg-delete-confirm-btn-${id}` : `kg-${testPrefix}-submit-${id}`}
      >
        {busy ? t("chatKnowledge.action.saving") : label}
      </Button>
    </DialogFooter>
  );
}

function ChoiceList<T extends string>({
  name, options, value, onChange, testPrefix,
}: {
  name: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  testPrefix: string;
}) {
  return (
    <div role="radiogroup" className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-1.5">
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1 text-12 transition-colors duration-base hover:bg-muted"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            data-testid={`${testPrefix}-${o.value}`}
          />
          <span className="text-background-foreground">{o.label}</span>
          {o.hint ? <span className="text-10 text-muted-foreground">{o.hint}</span> : null}
        </label>
      ))}
    </div>
  );
}

const objectOption = (o: KgObject, locale: Locale) => ({ value: o.id, label: o.name, hint: graphObjectKindLabel(o.kind, locale) });

function NoObjects() {
  const { t } = useI18n();
  return <p className="text-11 text-muted-foreground">{t("chatKnowledge.action.noObjects")}</p>;
}

function ReviseBody({ claim, busy, onSubmit, onCancel }: BodyProps) {
  const { t } = useI18n();
  const [text, setText] = React.useState(claim.statement);
  const next = text.trim();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.reviseTitle")}</DialogTitle>
        <DialogDescription>{t("chatKnowledge.action.reviseHint")}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={text}
        maxLength={2000}
        rows={4}
        aria-label={t("chatKnowledge.action.newStatement")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 回车就是「保存」（06-UX R3-4：改一条 ≤ 2 次点击——不对、改写，然后打字回车）；Shift+回车换行，输入法组字中不算。
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (next !== "" && next !== claim.statement && !busy) void onSubmit({ type: "reviseClaim", claimId: claim.id, statement: next });
        }}
        data-testid={`kg-revise-input-${claim.id}`}
      />
      <Footer
        id={claim.id} busy={busy} testPrefix="revise" label={t("chatKnowledge.action.save")}
        disabled={next === "" || next === claim.statement}
        onSubmit={() => void onSubmit({ type: "reviseClaim", claimId: claim.id, statement: next })}
        onCancel={onCancel}
      />
    </>
  );
}

function RevokeBody({ claim, busy, onSubmit, onCancel }: BodyProps) {
  const { t } = useI18n();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.revokeTitle")}</DialogTitle>
        <DialogDescription>
          {t("chatKnowledge.action.revokeHint")}
        </DialogDescription>
      </DialogHeader>
      <p className="rounded-md bg-muted p-2 text-11 text-muted-foreground" data-testid={`kg-delete-impact-${claim.id}`}>
        「{claim.statement}」
      </p>
      <Footer
        id={claim.id} busy={busy} testPrefix="delete" label={t("chatKnowledge.action.revoke")} destructive disabled={false}
        onSubmit={() => void onSubmit({ type: "revokeClaim", claimId: claim.id })}
        onCancel={onCancel}
      />
    </>
  );
}

function ContestBody({ claim, claims, busy, onSubmit, onCancel }: BodyProps & { claims: readonly KgClaim[] }) {
  const { t } = useI18n();
  const others = claims.filter((c) => c.id !== claim.id && claimTriState(c.status) !== null);
  const [other, setOther] = React.useState<string | null>(null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.contestTitle")}</DialogTitle>
        <DialogDescription>{t("chatKnowledge.action.contestHint")}</DialogDescription>
      </DialogHeader>
      {others.length === 0 ? (
        <p className="text-11 text-muted-foreground">{t("chatKnowledge.action.noOtherClaims")}</p>
      ) : (
        <ChoiceList
          name={`contest-${claim.id}`}
          options={others.map((c) => ({ value: c.id, label: c.statement }))}
          value={other}
          onChange={setOther}
          testPrefix={`kg-contest-target-${claim.id}`}
        />
      )}
      <Footer
        id={claim.id} busy={busy} testPrefix="contest" label={t("chatKnowledge.action.contest")} disabled={other === null}
        onSubmit={() => { if (other) void onSubmit({ type: "markContested", claimIds: [claim.id, other] }); }}
        onCancel={onCancel}
      />
    </>
  );
}

function MergeBody({
  claim, about, objects, busy, onSubmit, onCancel,
}: BodyProps & { about: readonly KgObject[]; objects: readonly KgObject[] }) {
  const { t, locale } = useI18n();
  const [keep, setKeep] = React.useState<string | null>(about[0]?.id ?? null);
  const [merge, setMerge] = React.useState<string | null>(null);
  const keepObj = objects.find((o) => o.id === keep);
  const candidates = objects.filter((o) => o.id !== keep && o.claimCount > 0);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.mergeTitle")}</DialogTitle>
        <DialogDescription>{t("chatKnowledge.action.mergeHint")}</DialogDescription>
      </DialogHeader>
      {about.length === 0 ? <NoObjects /> : (
        <>
          <p className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.action.keep")}</p>
          <ChoiceList
            name={`merge-keep-${claim.id}`}
            options={about.map(o => objectOption(o, locale))}
            value={keep}
            onChange={(v) => { setKeep(v); if (merge === v) setMerge(null); }}
            testPrefix={`kg-merge-keep-${claim.id}`}
          />
          <p className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.action.mergeInto", { name: keepObj ? `「${keepObj.name}」` : "" })}</p>
          <ChoiceList
            name={`merge-other-${claim.id}`}
            options={candidates.map(o => objectOption(o, locale))}
            value={merge}
            onChange={setMerge}
            testPrefix={`kg-merge-other-${claim.id}`}
          />
        </>
      )}
      <Footer
        id={claim.id} busy={busy} testPrefix="merge" label={t("chatKnowledge.action.merge")} disabled={keep === null || merge === null}
        onSubmit={() => {
          if (keep && merge) void onSubmit({ type: "mergeObjects", keepObjectId: keep, mergeObjectId: merge });
        }}
        onCancel={onCancel}
      />
    </>
  );
}

function SplitBody({
  claim, about, claims, busy, onSubmit, onCancel,
}: BodyProps & { about: readonly KgObject[]; claims: readonly KgClaim[] }) {
  const { t, locale } = useI18n();
  const [objectId, setObjectId] = React.useState<string | null>(about[0]?.id ?? null);
  const [name, setName] = React.useState("");
  const [moved, setMoved] = React.useState<Record<string, boolean>>({ [claim.id]: true });
  const related = claims.filter((c) => objectId !== null && c.aboutObjectIds.includes(objectId) && claimTriState(c.status) !== null);
  const moveClaimIds = related.filter((c) => moved[c.id]).map((c) => c.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.splitTitle")}</DialogTitle>
        <DialogDescription>{t("chatKnowledge.action.splitHint")}</DialogDescription>
      </DialogHeader>
      {about.length === 0 ? <NoObjects /> : (
        <>
          <ChoiceList
            name={`split-object-${claim.id}`}
            options={about.map(o => objectOption(o, locale))}
            value={objectId}
            onChange={(v) => { setObjectId(v); setMoved({ [claim.id]: true }); }}
            testPrefix={`kg-split-object-${claim.id}`}
          />
          <Input
            value={name}
            maxLength={200}
            placeholder={t("chatKnowledge.action.newName")}
            aria-label={t("chatKnowledge.action.newName")}
            onChange={(e) => setName(e.target.value)}
            data-testid={`kg-split-name-${claim.id}`}
          />
          <p className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.action.moveMemories")}</p>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {related.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-12">
                <input
                  type="checkbox"
                  checked={moved[c.id] ?? false}
                  onChange={(e) => setMoved((m) => ({ ...m, [c.id]: e.target.checked }))}
                  data-testid={`kg-split-claim-${claim.id}-${c.id}`}
                />
                <span className="text-background-foreground">{c.statement}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <Footer
        id={claim.id} busy={busy} testPrefix="split" label={t("chatKnowledge.action.split")}
        disabled={objectId === null || name.trim() === "" || moveClaimIds.length === 0}
        onSubmit={() => {
          if (objectId) void onSubmit({ type: "splitObject", objectId, newName: name.trim(), moveClaimIds });
        }}
        onCancel={onCancel}
      />
    </>
  );
}

function RenameBody({ claim, about, busy, onSubmit, onCancel }: BodyProps & { about: readonly KgObject[] }) {
  const { t, locale } = useI18n();
  const [objectId, setObjectId] = React.useState<string | null>(about[0]?.id ?? null);
  const current = about.find((o) => o.id === objectId);
  const [name, setName] = React.useState(current?.name ?? "");
  const next = name.trim();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("chatKnowledge.action.renameTitle")}</DialogTitle>
        <DialogDescription>{t("chatKnowledge.action.renameHint")}</DialogDescription>
      </DialogHeader>
      {about.length === 0 ? <NoObjects /> : (
        <>
          <ChoiceList
            name={`rename-object-${claim.id}`}
            options={about.map(o => objectOption(o, locale))}
            value={objectId}
            onChange={(v) => { setObjectId(v); setName(about.find((o) => o.id === v)?.name ?? ""); }}
            testPrefix={`kg-rename-object-${claim.id}`}
          />
          <Input
            value={name}
            maxLength={200}
            aria-label={t("chatKnowledge.action.newName")}
            onChange={(e) => setName(e.target.value)}
            data-testid={`kg-rename-input-${claim.id}`}
          />
        </>
      )}
      <Footer
        id={claim.id} busy={busy} testPrefix="rename" label={t("chatKnowledge.action.save")}
        disabled={objectId === null || next === "" || next === current?.name}
        onSubmit={() => { if (objectId) void onSubmit({ type: "renameObject", objectId, name: next }); }}
        onCancel={onCancel}
      />
    </>
  );
}
