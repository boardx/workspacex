import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "./locale";
export function readLocale() { return resolveLocale(cookies().get(LOCALE_COOKIE)?.value); }
