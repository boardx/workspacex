import { expect, it } from "vitest";
import { createCloudNginxConfig } from "../src/nginx.js";

it("keeps both CopilotKit stream locations open for long AI runs", () => {
  const config = createCloudNginxConfig({ domain: "www.boardx.com.cn", certificateFile: "/run/tls/fullchain.pem", certificateKeyFile: "/run/tls/key.pem" });
  expect(config).toContain("location = /api/copilotkit");
  expect(config).toContain("location ^~ /api/copilotkit/");
  expect(config.match(/proxy_read_timeout 3600s;/g)).toHaveLength(4);
  expect(config.match(/proxy_send_timeout 3600s;/g)).toHaveLength(4);
  expect(config).not.toContain("proxy_read_timeout 300s");
});
