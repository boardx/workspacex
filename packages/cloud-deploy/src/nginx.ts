export interface CloudNginxOptions {
  domain: string;
  certificateFile: string;
  certificateKeyFile: string;
}

/** An http-context include; certificates are prepared before provisioning. */
export function createCloudNginxConfig(options: CloudNginxOptions): string {
  if (options.domain.length > 253 || !options.domain.includes(".") ||
      !options.domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error("INVALID_TLS_DOMAIN");
  }
  for (const path of [options.certificateFile, options.certificateKeyFile]) {
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").includes("..")) {
      throw new Error("INVALID_TLS_CERTIFICATE_PATH");
    }
  }
  const proxy = (location: string, upstream: string) => `    location ${location} {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $workspacex_connection_upgrade;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }`;
  return `# Generated WorkspaceX cloud ingress. Include inside nginx http {}.
map $http_upgrade $workspacex_connection_upgrade {
    default upgrade;
    '' close;
}
server {
    listen 80;
    server_name ${options.domain};
    return 308 https://${options.domain}$request_uri;
}
server {
    listen 443 ssl;
    server_name ${options.domain};
    ssl_certificate ${options.certificateFile};
    ssl_certificate_key ${options.certificateKeyFile};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 100m;
${proxy("= /api/copilotkit", "http://127.0.0.1:3000")}
${proxy("^~ /api/copilotkit/", "http://127.0.0.1:3000")}
    location = /api { return 308 /api/; }
${proxy("/api/", "http://127.0.0.1:3200/")}
${proxy("/", "http://127.0.0.1:3000")}
}
`;
}
