/**
 * I-4, the instance half: "`CanvasInstance` 的 `(templateKey, templateVersion)` 写入后
 * 永不改变；模板发新版不改动任何已建实例."
 *
 * `template-lifecycle.ts`'s `publishNewVersion` updates the REGISTRY. This file is the
 * other half of the invariant: a `CanvasInstance` freezes the `(templateKey,
 * templateVersion)` pair it was built with at creation time and never re-reads the
 * registry afterwards. There is deliberately no function here that takes an instance and
 * "refreshes" its template reference — that capability not existing is what makes I-4 true
 * by construction rather than by every call site remembering not to call it.
 */

/** The frozen template reference a `CanvasInstance` carries for its entire lifetime. */
export interface FrozenTemplateRef {
  readonly templateKey: string;
  readonly templateVersion: number;
}

/**
 * Capture the template reference at instantiation. This is the ONLY place a
 * `CanvasInstance`'s `(templateKey, templateVersion)` is ever assigned — after this call
 * the pair is carried on the instance record itself, not looked up again.
 */
export function freezeTemplateRef(templateKey: string, templateVersionAtCreation: number): FrozenTemplateRef {
  return { templateKey, templateVersion: templateVersionAtCreation };
}

/** A minimal `CanvasInstance` projection: just enough to state and check I-4. */
export interface CanvasInstanceRecord {
  readonly instanceId: string;
  readonly templateRef: FrozenTemplateRef;
}

/**
 * Build the instance record at creation time. Structurally identical to `freezeTemplateRef`
 * plus an id — kept as a separate, named step because "the instance's template reference"
 * and "the act of creating an instance" are different moments in the real flow
 * (`instantiateForSegment`, F102), and I-4 is a claim about the first one never moving once
 * the second one has happened.
 */
export function createInstance(instanceId: string, templateKey: string, templateVersion: number): CanvasInstanceRecord {
  return { instanceId, templateRef: freezeTemplateRef(templateKey, templateVersion) };
}

/**
 * Read back an instance's frozen template reference. This is the assertion surface for
 * I-4: no matter what has happened to the registry since `createInstance` ran (a new
 * version published, the old version archived, restored, archived again), this function's
 * answer for a given `CanvasInstanceRecord` is a pure projection of that one record — it
 * takes no registry, because I-4 says it must not need one.
 */
export function readFrozenTemplateRef(instance: CanvasInstanceRecord): FrozenTemplateRef {
  return instance.templateRef;
}
