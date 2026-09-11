import { describe, expect, it } from "vitest";
import { createCloudNginxConfig } from "./nginx.js";
const options = { domain: "workspace.example.com", certificateFile: "/etc/tls/fullchain.pem", certificateKeyFile: "/etc/tls/key.pem" };
describe("cloud TLS ingress", () => {
  it("routes Copilot to Web and strips only ordinary API prefix", () => {
    const config = createCloudNginxConfig(options);
    expect(config).toContain("location = /api/copilotkit {\n        proxy_pass http://127.0.0.1:3000;");
    expect(config).toContain("location ^~ /api/copilotkit/ {\n        proxy_pass http://127.0.0.1:3000;");
    expect(config).toContain("location /api/ {\n        proxy_pass http://127.0.0.1:3200/;");
    expect(config).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(config).toContain("proxy_buffering off;");
  });
  it.each(["a.com; include /tmp/x;", "a.com\n", "*.example.com", "localhost", "a..com"])("rejects invalid domain %s", domain => {
    expect(() => createCloudNginxConfig({ ...options, domain })).toThrow("INVALID_TLS_DOMAIN");
  });
  it.each(["/etc/key;", "/etc/key\n", "/etc/$secret", "relative.pem", "/etc/../key"])("rejects invalid path %s", certificateKeyFile => {
    expect(() => createCloudNginxConfig({ ...options, certificateKeyFile })).toThrow("INVALID_TLS_CERTIFICATE_PATH");
  });
});
