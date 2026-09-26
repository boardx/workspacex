"use client";
import * as React from "react";
import Image from "next/image";
import {
  surveyChoices,
  type SurveyWorkflowQuestion,
  type SurveyAnswerValue,
} from "@repo/contracts/survey-question-types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  QuestionMaterial,
  type SurveyUpload,
  type SurveyRemoveUpload,
} from "./question-material";

type Props = {
  question: SurveyWorkflowQuestion;
  value?: SurveyAnswerValue;
  onChange: (value: SurveyAnswerValue) => void;
  errors?: string[];
  upload?: SurveyUpload;
  removeUpload?: SurveyRemoveUpload;
  shuffleSeed?: string;
  showDescription?: boolean;
};
export function SurveyQuestionRenderer({
  question: q,
  value,
  onChange,
  errors = [],
  upload,
  removeUpload,
  shuffleSeed = "preview",
  showDescription = true,
}: Props) {
  const config = q.config ?? {};
  const choices = surveyChoices(q);
  const scalar = typeof value === "string" ? value : "";
  const record =
    value && !Array.isArray(value) && typeof value === "object" ? value : {};
  const selected = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : Array.isArray(record.selected)
        ? record.selected
        : typeof record.selected === "string"
          ? [record.selected]
          : [];
  const patch = (key: string, next: string | string[]) =>
    onChange({ ...record, [key]: next });
  const [dragged, setDragged] = React.useState<string>();
  const priority = (id: string) => {
    let hash = 2166136261;
    for (const char of `${shuffleSeed}:${q.id}:${id}`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  const orderedChoices = config.shuffleOptions
    ? [...choices].sort(
        (a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id),
      )
    : choices;
  const label = q.title || "未命名题目";
  const controlClass =
    "w-full rounded-md border border-input bg-background p-2 text-13";
  function select(id: string, multi: boolean) {
    let next: string | string[] = id;
    if (multi) {
      const exclusive = config.exclusiveOptionIds ?? [];
      next = selected.includes(id)
        ? selected.filter((item) => item !== id)
        : exclusive.includes(id)
          ? [id]
          : [...selected.filter((item) => !exclusive.includes(item)), id];
    }
    onChange(
      config.other
        ? {
            selected: next,
            other:
              (Array.isArray(next)
                ? next.includes("__other__")
                : next === "__other__") && typeof record.other === "string"
                ? record.other
                : "",
          }
        : next,
    );
  }
  function reorder(id: string, target: number) {
    const current =
      Array.isArray(value) && value.length
        ? [...value]
        : choices.map((choice) => choice.id);
    const index = current.indexOf(id);
    if (index < 0 || target < 0 || target >= current.length) return;
    current.splice(index, 1);
    current.splice(target, 0, id);
    onChange(current);
  }
  let control: React.ReactNode;
  if (q.type === "description" || q.type === "page_break")
    return (
      <section
        aria-label={label}
        className="space-y-2 border-b border-border py-3"
      >
        <h2 className="text-18 font-semibold">{label}</h2>
        {config.images?.description && (
          <Image
            unoptimized
            width={600}
            height={320}
            src={config.images.description.url}
            alt={config.images.description.alt}
            className="max-h-80 max-w-full object-contain"
          />
        )}
        {config.description && (
          <p className="whitespace-pre-wrap text-13">{config.description}</p>
        )}
      </section>
    );
  if (
    ["single", "multi", "image_single", "image_multi", "scale"].includes(q.type)
  ) {
    const multi = q.type === "multi" || q.type === "image_multi";
    control = (
      <div className="space-y-2">
        {orderedChoices.map((choice) => (
          <label
            key={choice.id}
            className="flex min-w-0 items-center gap-3 rounded-md border border-border px-3 py-3 text-13"
          >
            <input
              type={multi ? "checkbox" : "radio"}
              name={q.id}
              value={choice.id}
              checked={
                selected.includes(choice.id) || selected.includes(choice.label)
              }
              onChange={() => select(choice.id, multi)}
            />
            <span className="min-w-0 break-words">
              {config.images?.[choice.id] && (
                <Image
                  unoptimized
                  width={600}
                  height={320}
                  src={config.images[choice.id]!.url}
                  alt={config.images[choice.id]!.alt}
                  className="mb-2 max-h-40 max-w-full rounded-md object-contain"
                />
              )}
              {choice.label}
            </span>
          </label>
        ))}
        {config.other && (
          <>
            <label className="flex items-center gap-3 text-13">
              <input
                type={multi ? "checkbox" : "radio"}
                name={q.id}
                checked={selected.includes("__other__")}
                onChange={() => select("__other__", multi)}
              />
              其他
            </label>
            {selected.includes("__other__") && (
              <Input
                aria-label={`${label}：其他说明`}
                value={typeof record.other === "string" ? record.other : ""}
                onChange={(event) => patch("other", event.target.value)}
              />
            )}
          </>
        )}
      </div>
    );
  } else if (q.type === "dropdown") {
    control = (
      <select
        aria-label={label}
        className={controlClass}
        value={selected[0] ?? ""}
        onChange={(event) => select(event.target.value, false)}
      >
        <option value="">请选择</option>
        {orderedChoices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
        {config.other && <option value="__other__">其他</option>}
      </select>
    );
    if (config.other && selected.includes("__other__"))
      control = (
        <div className="space-y-2">
          {control}
          <Input
            aria-label={`${label}：其他说明`}
            value={typeof record.other === "string" ? record.other : ""}
            onChange={(event) => patch("other", event.target.value)}
          />
        </div>
      );
  } else if (q.type.startsWith("matrix_")) {
    control = (
      <div className="space-y-4">
        {(config.rows ?? []).map((row) => (
          <fieldset
            key={row.id}
            id={`answer-${q.id}-${row.id}`}
            tabIndex={-1}
            className="min-w-0 rounded-md border border-border p-4"
          >
            <legend className="px-1 text-13">
              {row.label}
              {row.required ? " *" : ""}
            </legend>
            {q.type === "matrix_input" ? (
              <Input
                aria-label={`${label}：${row.label}`}
                value={
                  typeof record[row.id] === "string"
                    ? (record[row.id] as string)
                    : ""
                }
                onChange={(event) => patch(row.id, event.target.value)}
              />
            ) : q.type === "matrix_dropdown" ? (
              <select
                aria-label={`${label}：${row.label}`}
                className={controlClass}
                value={
                  typeof record[row.id] === "string"
                    ? (record[row.id] as string)
                    : ""
                }
                onChange={(event) => patch(row.id, event.target.value)}
              >
                <option value="">请选择</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-wrap gap-3">
                {choices.map((choice) => (
                  <label
                    key={choice.id}
                    className="flex items-center gap-2 text-13"
                  >
                    <input
                      type={q.type === "matrix_multi" ? "checkbox" : "radio"}
                      name={`${q.id}-${row.id}`}
                      checked={
                        q.type === "matrix_multi"
                          ? Array.isArray(record[row.id]) &&
                            (record[row.id] as string[]).includes(choice.id)
                          : record[row.id] === choice.id
                      }
                      onChange={(event) => {
                        const current = Array.isArray(record[row.id])
                          ? (record[row.id] as string[])
                          : [];
                        patch(
                          row.id,
                          q.type === "matrix_multi"
                            ? event.target.checked
                              ? config.exclusiveOptionIds?.includes(choice.id)
                                ? [choice.id]
                                : [
                                    ...current.filter(
                                      (id) =>
                                        !config.exclusiveOptionIds?.includes(
                                          id,
                                        ),
                                    ),
                                    choice.id,
                                  ]
                              : current.filter((id) => id !== choice.id)
                            : choice.id,
                        );
                      }}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ))}
      </div>
    );
  } else if (q.type === "multiple_text" || q.type === "address") {
    control = (
      <div className="grid gap-3 sm:grid-cols-2">
        {(config.fields ?? []).map((field) => (
          <label key={field.id} className="text-13">
            {field.label}
            {field.required ? " *" : ""}
            <Input
              aria-label={`${label}：${field.label}`}
              value={
                typeof record[field.id] === "string"
                  ? (record[field.id] as string)
                  : ""
              }
              onChange={(event) => patch(field.id, event.target.value)}
            />
          </label>
        ))}
      </div>
    );
  } else if (q.type === "cascade") {
    const path = Array.isArray(value) ? value : [];
    const paths = config.cascadePaths ?? [];
    const levels = Math.max(0, ...paths.map((item) => item.length));
    control = (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: levels }, (_, level) => {
          const options = [
            ...new Set(
              paths
                .filter((item) =>
                  path
                    .slice(0, level)
                    .every((part, index) => item[index] === part),
                )
                .map((item) => item[level])
                .filter(Boolean),
            ),
          ];
          return (
            <label key={level} className="text-13">
              第 {level + 1} 级
              <select
                className={controlClass}
                aria-label={`${label}：第 ${level + 1} 级`}
                disabled={level > path.length}
                value={path[level] ?? ""}
                onChange={(event) =>
                  onChange([
                    ...path.slice(0, level),
                    ...(event.target.value ? [event.target.value] : []),
                  ])
                }
              >
                <option value="">请选择</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    );
  } else if (q.type === "rating" || q.type === "nps") {
    const minimum = config.min ?? (q.type === "nps" ? 0 : 1),
      maximum = config.max ?? (q.type === "nps" ? 10 : 5);
    const step = config.step && config.step > 0 ? config.step : 1;
    const count = Math.max(
      0,
      Math.floor((maximum - minimum) / step + 1e-8) + 1,
    );
    control = (
      <div className="space-y-2">
        {count > 101 ? (
          <Input
            type="number"
            aria-label={label}
            min={minimum}
            max={maximum}
            step={step}
            value={scalar}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: count }, (_, index) =>
              Number((minimum + index * step).toFixed(10)),
            ).map((number) => (
              <label
                key={number}
                className="flex items-center gap-1 rounded-md border border-border p-2 text-13"
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={scalar === String(number)}
                  onChange={() => onChange(String(number))}
                />
                {q.type === "rating" ? `${number} 星` : number}
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-between text-12 text-muted-foreground">
          <span>{config.lowLabel}</span>
          <span>{config.highLabel}</span>
        </div>
      </div>
    );
  } else if (q.type === "slider") {
    control = (
      <div className="space-y-2">
        <input
          className="w-full"
          type="range"
          aria-label={label}
          min={config.min ?? 0}
          max={config.max ?? 100}
          step={config.step ?? 1}
          value={scalar || config.min || 0}
          onChange={(event) => onChange(event.target.value)}
          onPointerUp={(event) => onChange(event.currentTarget.value)}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              onChange(event.currentTarget.value);
          }}
        />
        <p className="text-13" aria-live="polite">
          {scalar === ""
            ? "尚未选择，请拖动滑块"
            : `${scalar}${config.unit ?? ""}`}
        </p>
        <div className="flex justify-between text-12">
          <span>{config.lowLabel}</span>
          <span>{config.highLabel}</span>
        </div>
      </div>
    );
  } else if (q.type === "ranking") {
    const ids =
      Array.isArray(value) && value.length
        ? value
        : choices.map((choice) => choice.id);
    control = (
      <div className="space-y-2">
        <p className="text-12 text-muted-foreground">
          拖动、使用方向键或上下移动按钮排序；完成后确认顺序。
        </p>
        <ol className="space-y-2">
          {ids.map((id, index) => (
            <li
              key={id}
              draggable
              tabIndex={0}
              aria-label={`${choices.find((choice) => choice.id === id)?.label}，第 ${index + 1} 位`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-13 focus-visible:ring-2 focus-visible:ring-ring"
              onDragStart={() => setDragged(id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) reorder(dragged, index);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  reorder(id, index + (event.key === "ArrowUp" ? -1 : 1));
                }
              }}
            >
              <span className="min-w-0 flex-1 break-words">
                {index + 1}. {choices.find((choice) => choice.id === id)?.label}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`上移 ${choices.find((choice) => choice.id === id)?.label}`}
                disabled={!index}
                onClick={() => reorder(id, index - 1)}
              >
                上移
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`下移 ${choices.find((choice) => choice.id === id)?.label}`}
                disabled={index === ids.length - 1}
                onClick={() => reorder(id, index + 1)}
              >
                下移
              </Button>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={() => onChange(ids)}>
          确认当前顺序
        </Button>
        {!Array.isArray(value) && <p className="text-12">尚未确认排序</p>}
      </div>
    );
  } else if (q.type === "allocation") {
    const total = Object.values(record).reduce(
      (sum, item) =>
        sum +
        (typeof item === "string" && Number.isFinite(Number(item))
          ? Number(item)
          : 0),
      0,
    );
    control = (
      <div className="space-y-3">
        {choices.map((choice) => (
          <label key={choice.id} className="block text-13">
            {choice.label}
            <Input
              type="number"
              min={0}
              aria-label={`${label}：${choice.label}`}
              value={
                typeof record[choice.id] === "string"
                  ? (record[choice.id] as string)
                  : ""
              }
              onChange={(event) => patch(choice.id, event.target.value)}
            />
          </label>
        ))}
        <p aria-live="polite" className="text-13">
          已分配 {total}，还差 {(config.total ?? 100) - total}
        </p>
      </div>
    );
  } else if (q.type === "file" || q.type === "signature") {
    control = (
      <QuestionMaterial
        questionId={q.id}
        signature={q.type === "signature"}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        upload={upload}
        removeUpload={removeUpload}
        maxFiles={config.maxFiles ?? (q.type === "signature" ? 1 : 3)}
        maxBytes={config.maxFileBytes}
        accept={config.allowedExtensions
          ?.map((extension) => `.${extension}`)
          .join(",")}
      />
    );
  } else if (q.type === "open") {
    control = (
      <Textarea
        aria-label={label}
        value={scalar}
        maxLength={config.maxLength ?? 20000}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else {
    const type =
      (
        {
          number: "number",
          date: "date",
          time: "time",
          datetime: "datetime-local",
          email: "email",
          phone: "tel",
        } as Record<string, string>
      )[q.type] ?? "text";
    control = (
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          type={type}
          value={scalar}
          min={config.min}
          max={config.max}
          step={config.step}
          maxLength={config.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
        {config.unit && <span className="text-13">{config.unit}</span>}
      </div>
    );
  }
  return (
    <fieldset
      id={`answer-${q.id}`}
      tabIndex={-1}
      aria-describedby={errors.length ? `error-${q.id}` : undefined}
      className="min-w-0 space-y-3"
    >
      <legend className="mb-3 break-words text-14 font-medium">
        {label}
        {q.required ? " *" : ""}
      </legend>
      {showDescription && config.description && (
        <p className="whitespace-pre-wrap text-13 text-muted-foreground">
          {config.description}
        </p>
      )}
      {control}
      {errors.length > 0 && (
        <ul id={`error-${q.id}`} className="space-y-1 text-12 text-destructive">
          {errors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
