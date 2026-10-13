FROM node:22-slim
ARG APT_MIRROR=https://deb.debian.org
RUN mkdir -p /etc/ssl/certs && node -e "require('node:fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt',require('node:tls').rootCertificates.join('\\n')+'\\n')"
RUN sed -Ei "s#http://deb.debian.org#${APT_MIRROR}#g" /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=0 -o Acquire::https::Timeout=30 update && apt-get install -y --no-install-recommends python3 git procps \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/local/bin/node /usr/bin/node
WORKDIR /workspace
RUN npm install --no-audit --no-fund tsx@4.23.1 zod@3.25.76 pg@8.22.0
USER 10001:10001
