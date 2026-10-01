import { z } from "zod";

/** UI limits are projections of the operation schema; undefined preserves an unbounded contract. */
export type TagInputLimits = Readonly<{ maxTags?: number; maxTagLength?: number }>;

export function tagInputLimits(schema: z.ZodTypeAny): TagInputLimits {
  while (schema instanceof z.ZodEffects || schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    schema = schema instanceof z.ZodEffects ? schema.innerType() : schema instanceof z.ZodDefault ? schema.removeDefault() : schema.unwrap();
  }
  if (!(schema instanceof z.ZodArray) || !(schema.element instanceof z.ZodString)) {
    throw new Error("Tag input requires an array of strings");
  }
  return Object.freeze({ maxTags: schema._def.maxLength?.value, maxTagLength: schema.element.maxLength ?? undefined });
}
