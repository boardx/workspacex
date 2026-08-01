import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  DESIGN_FACET_DEFINITIONS,
  designFacetKeys,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import { evaluatePublishGate } from "../../src/domain/templates/publish-blueprint-version";
import {
  publishBlueprintVersionUseCase,
  PublishBlueprintVersionError,
} from "../../src/application/templates/publish-blueprint-version";
import type { BlueprintBinding } from "../../src/domain/templates/designer-shell";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";

/**
 * F22 —— **发布门槛是两道并列门槛的 `&&`**（必填面 F17 ∧ 试跑面 F21）。
 *
 * 两道门各自的判定语句已经在 `required-column-drives-gate.test.ts`（F17）与
 * `trial-run-prereq-for-publish.test.ts`（F21）证明过；本文件只证明**组合**：
 * 四种真值组合都要落在正确的一格，且都拦时报的是必填面（契约 err 顺序）。
 */

function withRequired(key: string, required: boolean): DesignFacetRow[] {
  return DESIGN_FACET_DEFINITIONS.map((r) => (r.designFacetKey === key ? { ...r, required } : r));
}

const NO_TRIAL_RUN: BlueprintBinding[] = [];
const HAS_TRIAL_RUN: BlueprintBinding[] = [{ kind: "trial-run" }];

describe("组合门槛的四种真值组合", () => {
  it("必填未完成 ∧ 未试跑 ⇒ 阻断，报必填面（判定顺序）", () => {
    const key = designFacetKeys()[0]!;
    const table = withRequired(key, true);
    const verdict = evaluatePublishGate([], NO_TRIAL_RUN, table);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasonCode).toBe("REQUIRED_CONFIG_INCOMPLETE");
    expect(verdict.missingKeys).toEqual([key]);
  });

  it("必填已完成 ∧ 未试跑 ⇒ 阻断，报试跑面", () => {
    const verdict = evaluatePublishGate(designFacetKeys(), NO_TRIAL_RUN);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasonCode).toBe("TRIAL_RUN_REQUIRED");
    expect(verdict.missingKeys).toEqual([]);
  });

  it("必填未完成 ∧ 已试跑 ⇒ 仍然阻断，报必填面 —— 试跑不能顶替必填", () => {
    const key = designFacetKeys()[0]!;
    const table = withRequired(key, true);
    const verdict = evaluatePublishGate([], HAS_TRIAL_RUN, table);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasonCode).toBe("REQUIRED_CONFIG_INCOMPLETE");
    expect(verdict.missingKeys).toEqual([key]);
  });

  it("必填已完成 ∧ 已试跑 ⇒ 放行", () => {
    const verdict = evaluatePublishGate(designFacetKeys(), HAS_TRIAL_RUN);
    expect(verdict.blocked).toBe(false);
    expect(verdict.reasonCode).toBeNull();
    expect(verdict.missingKeys).toEqual([]);
  });

  it("现状：真实表零必填 ⇒ 唯一的门是试跑面（与 D-2 现状一致，不是门失效）", () => {
    expect(evaluatePublishGate([], NO_TRIAL_RUN).reasonCode).toBe("TRIAL_RUN_REQUIRED");
    expect(evaluatePublishGate([], HAS_TRIAL_RUN).blocked).toBe(false);
  });
});

describe("用例层：阻断时抛出的错误码是契约成员之一", () => {
  const history: BlueprintVersion[] = [];

  it("REQUIRED_CONFIG_INCOMPLETE 抛出且携带 missingKeys", () => {
    const key = designFacetKeys()[0]!;
    const table = withRequired(key, true);
    expect(() =>
      publishBlueprintVersionUseCase(
        {
          blueprintId: "bp-1",
          completedKeys: [],
          bindings: HAS_TRIAL_RUN,
          history,
          currentVersion: null,
          content: {},
          changedDesignFacetKeys: [],
          newVersionId: "v-1",
        },
        table,
      ),
    ).toThrowError(PublishBlueprintVersionError);

    try {
      publishBlueprintVersionUseCase(
        {
          blueprintId: "bp-1",
          completedKeys: [],
          bindings: HAS_TRIAL_RUN,
          history,
          currentVersion: null,
          content: {},
          changedDesignFacetKeys: [],
          newVersionId: "v-1",
        },
        table,
      );
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(PublishBlueprintVersionError);
      const err = e as PublishBlueprintVersionError;
      expect(err.reasonCode).toBe("REQUIRED_CONFIG_INCOMPLETE");
      expect(err.missingKeys).toEqual([key]);
    }
  });

  it("TRIAL_RUN_REQUIRED 抛出且 missingKeys 为空", () => {
    try {
      publishBlueprintVersionUseCase({
        blueprintId: "bp-1",
        completedKeys: designFacetKeys(),
        bindings: NO_TRIAL_RUN,
        history,
        currentVersion: null,
        content: {},
        changedDesignFacetKeys: [],
        newVersionId: "v-1",
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(PublishBlueprintVersionError);
      const err = e as PublishBlueprintVersionError;
      expect(err.reasonCode).toBe("TRIAL_RUN_REQUIRED");
      expect(err.missingKeys).toEqual([]);
    }
  });

  it("两道门都放行 ⇒ 不抛错，返回发布结果", () => {
    const result = publishBlueprintVersionUseCase({
      blueprintId: "bp-1",
      completedKeys: designFacetKeys(),
      bindings: HAS_TRIAL_RUN,
      history,
      currentVersion: null,
      content: { name: "v1" },
      changedDesignFacetKeys: ["a"],
      newVersionId: "v-1",
    });
    expect(result.versionNumber).toBe(1);
    expect(result.archivedVersionId).toBeNull();
  });
});

describe("被拒时用的是契约里已有的那两个码", () => {
  it("两码都在 publishBlueprintVersion.err 里，且都是合法的 TemplateError 成员", () => {
    expect(templates.operations.publishBlueprintVersion.err).toContain("REQUIRED_CONFIG_INCOMPLETE");
    expect(templates.operations.publishBlueprintVersion.err).toContain("TRIAL_RUN_REQUIRED");
    expect(templates.TemplateError.safeParse("REQUIRED_CONFIG_INCOMPLETE").success).toBe(true);
    expect(templates.TemplateError.safeParse("TRIAL_RUN_REQUIRED").success).toBe(true);
  });
});
