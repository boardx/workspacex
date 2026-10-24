# One-time preparation tooling image. It contains no repository, data or secrets.
# NODE_IMAGE must be the existing reviewed, cached digest from publish.env.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
USER root
ARG APT_MIRROR=https://deb.debian.org
RUN set -eu; \
    apt_host="${APT_MIRROR#*://}"; apt_host="${apt_host%%/*}"; \
    case "$apt_host" in ''|*[!a-zA-Z0-9.-]*) exit 2;; esac; \
    sed -Ei "s#//deb\.debian\.org#//${apt_host}#g" /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates chromium nginx; \
    rm -rf /var/lib/apt/lists/*; \
    node --version; chromium --version; nginx -v
ENTRYPOINT ["/usr/sbin/nginx"]
CMD ["-g", "daemon off;"]
