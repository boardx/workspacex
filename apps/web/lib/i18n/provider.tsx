"use client";
import * as React from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locale";
import { translate, type MessageKey, type MessageParams } from "./messages";
const CHANNEL = "workspacex-locale";
type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, params?: MessageParams) => string };
// Standalone legacy components render the product default; the application always installs the provider.
const I18nContext = React.createContext<I18nValue>({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: (key, params) => translate(DEFAULT_LOCALE, key, params) });
export function I18nProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const [locale, updateLocale] = React.useState(initialLocale);
  const channel = React.useRef<BroadcastChannel | null>(null);
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      const current = new BroadcastChannel(CHANNEL);
      channel.current = current;
      current.onmessage = (event: MessageEvent<unknown>) => { if (isLocale(event.data)) updateLocale(event.data); };
      return () => { channel.current = null; current.close(); };
    } catch { /* Language switching also works without cross-tab messaging. */ }
  }, []);
  React.useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = React.useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try { document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Memory-only in restricted browsers. */ }
    try { channel.current?.postMessage(next); } catch { /* A closed/blocked channel must not prevent switching. */ }
  }, []);
  const value = React.useMemo(() => ({ locale, setLocale, t: (key: MessageKey, params?: MessageParams) => translate(locale, key, params) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() { return React.useContext(I18nContext); }
