import { redirect } from "next/navigation";

/**
 * The browser bearer lives in localStorage, so the server cannot prove that a
 * request for `/` is authenticated. Redirect before rendering any product
 * component; the login route delegates an already-valid browser session to
 * `/home` (the org home page, `DEFAULT_LANDING`) after SessionProvider has hydrated it.
 */
export default function HomePage(): never {
  redirect("/login");
}
