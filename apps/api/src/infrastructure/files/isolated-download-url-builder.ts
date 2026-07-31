/**
 * Where a download URL points (F32).
 *
 * ## The isolated origin is the security boundary, not a deployment detail
 *
 * The contract is verbatim: 「未知类型一律 `Content-Disposition: attachment` + **隔离域名**，
 * 不在主域内联渲染（防 XSS / SVG 脚本注入 / HTML 直接渲染）」. A file served from the main
 * origin runs in the main origin: an uploaded `.html`, or an `.svg` with a `<script>` in it,
 * executes with the session's cookies and same-origin reach. Serving it from a separate host
 * means the same bytes execute in a context that owns nothing.
 *
 * ⇒ `WORKSPACEX_DOWNLOAD_ORIGIN`. Two properties are asserted rather than assumed:
 *
 *   1. it is configurable at all -- otherwise it is the main origin by omission, on every
 *      deployment where nobody thought about it;
 *   2. the default is a **distinct host** (`downloads.localhost:3200`, not `localhost:3200`),
 *      so a developer who never sets the variable still gets a different origin. A default of
 *      「the API's own host」 would make local development pass through the exact configuration
 *      that is the vulnerability in production, and the difference would never show up in a
 *      test.
 *
 * ⚠ Cross-origin serving means the redeeming request must carry the session -- the token alone
 *   is not enough, since the grant is bound to a principal. That is a real constraint on the
 *   deployment (the isolated host must reach the same auth), stated here because it is
 *   invisible in the code.
 */
import type { DownloadUrlBuilder } from "../../application/files/download-ports";

/**
 * ⚠ A distinct HOST, deliberately -- see the header. `.localhost` subdomains resolve to
 * 127.0.0.1 in every current browser, so this works out of the box without a hosts entry.
 */
const DEFAULT_ORIGIN = "http://downloads.localhost:3200";

export class IsolatedDownloadUrlBuilder implements DownloadUrlBuilder {
  constructor(private readonly origin: string = process.env.WORKSPACEX_DOWNLOAD_ORIGIN ?? DEFAULT_ORIGIN) {}

  build(token: string): string {
    // `encodeURIComponent` even though the token is base64url (already URL-safe): the encoding
    // of the token is a decision made in `domain/files/download-grant.ts`, and this file must
    // not silently depend on it staying that way.
    return `${this.origin.replace(/\/+$/, "")}/downloads/${encodeURIComponent(token)}`;
  }
}
