import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * `/` is a public entry decision, not an authenticated product response. The
 * bearer authority is browser-local, so the server must redirect before Next
 * can serve the optimized static route. LoginSessionGate then forwards a
 * browser with a validated existing session to `/projects`.
 */
export function middleware(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", request.url), 307);
}

export const config = {
  matcher: ["/"],
};
