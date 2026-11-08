"use client";
import * as React from "react";
import type { AiCatalogKind, AiCatalogWrite } from "@/lib/ai-catalog-admin";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
export function AiCatalogDefinitionForm({
  kind,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  kind: AiCatalogKind;
  initial?: AiCatalogWrite;
  busy: boolean;
  onSave: (definition: AiCatalogWrite) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState(initial?.input.name ?? "");
  const [description, setDescription] = React.useState(
    initial?.input.description ?? "",
  );
  const [body, setBody] = React.useState(
    initial?.kind === "agent"
      ? initial.input.instructions
      : (initial?.input.content ?? ""),
  );
  const [model, setModel] = React.useState(
    initial?.kind === "agent" ? (initial.input.modelId ?? "") : "",
  );
  const [stable, setStable] = React.useState(
    initial?.kind === "skill" ? initial.input.stableName : "",
  );
  const prefix = React.useId();
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(
          kind === "agent"
            ? {
                kind,
                input: {
                  name,
                  description,
                  instructions: body,
                  modelId: model.trim() || null,
                },
              }
            : {
                kind,
                input: { name, description, stableName: stable, content: body },
              },
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-name`}>{t("aiCatalog.name")}</Label>
        <Input
          id={`${prefix}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          disabled={busy}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-description`}>
          {t("aiCatalog.description")}
        </Label>
        <Textarea
          id={`${prefix}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          disabled={busy}
        />
      </div>
      {kind === "agent" ? (
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-model`}>{t("aiCatalog.model")}</Label>
          <Input
            id={`${prefix}-model`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-stable`}>
            {t("aiCatalog.stableName")}
          </Label>
          <Input
            id={`${prefix}-stable`}
            value={stable}
            onChange={(e) => setStable(e.target.value)}
            required
            maxLength={200}
            disabled={busy}
          />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-body`}>
          {t(kind === "agent" ? "aiCatalog.instructions" : "aiCatalog.content")}
        </Label>
        <Textarea
          id={`${prefix}-body`}
          className="min-h-52 font-mono"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required={kind === "skill"}
          disabled={busy}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t("aiCatalog.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          {t("aiCatalog.cancel")}
        </Button>
      </div>
    </form>
  );
}
