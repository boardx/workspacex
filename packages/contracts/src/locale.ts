import { z } from "zod";

/** Shared UI/API locale coordinates. Execution language is a separate concern. */
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export const Locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof Locale>;
