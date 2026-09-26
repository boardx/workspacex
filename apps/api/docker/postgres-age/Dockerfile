# Postgres 16 + pgvector + Apache AGE (ADR-114).
#
# Base stays the image this repo already used (`pgvector/pgvector:pg16`), so pgvector is
# unchanged; AGE is compiled on top. The AGE source is pinned to a COMMIT, not a tag: tags
# on apache/age are movable release-candidate names, and "the graph extension silently
# changed under us" is exactly the drift ADR-114 says we must not allow. Upgrading AGE or
# the Postgres major is a deliberate edit of this file, validated by
# `tests/db/age-pgvector-extensions.test.ts` + `graph:rebuild` parity (F04).
#
# Build args (defaults = local/dev compose; #4081 CN release overrides them):
# - PGVECTOR_IMAGE: the base. The CN publisher passes a reviewed `pgvector/pgvector` DIGEST.
# - APT_MIRROR / AGE_REPOSITORY: reachable mirrors for hosts without Debian/GitHub access.
#   A mirror cannot change what is built: AGE is fetched by commit hash, not by name.
# - SOURCE_REVISION: OCI revision label, verified by publish-cn-release.sh like every
#   other image it publishes.
ARG PGVECTOR_IMAGE=pgvector/pgvector:pg16
FROM ${PGVECTOR_IMAGE}

# PG16/v1.6.0-rc0
ARG AGE_COMMIT=2db2f060c4c9265a14d40f007eb8c56febf31e4c
ARG AGE_REPOSITORY=https://github.com/apache/age.git
ARG APT_MIRROR=https://deb.debian.org

RUN set -eux; \
    sed -Ei "s#https?://deb.debian.org#${APT_MIRROR}#g" /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential ca-certificates git flex bison postgresql-server-dev-16; \
    git init /tmp/age; \
    git -C /tmp/age fetch --depth 1 "${AGE_REPOSITORY}" "${AGE_COMMIT}"; \
    git -C /tmp/age checkout FETCH_HEAD; \
    test "$(git -C /tmp/age rev-parse HEAD)" = "${AGE_COMMIT}"; \
    make -C /tmp/age; \
    make -C /tmp/age install; \
    rm -rf /tmp/age; \
    apt-get purge -y --auto-remove build-essential git flex bison postgresql-server-dev-16; \
    rm -rf /var/lib/apt/lists/*

ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION

# AGE must be preloaded: with it in shared_preload_libraries a non-superuser session
# (the runtime role `app_rw`) can use the extension without `LOAD 'age'`, which is a
# superuser-only statement for libraries outside $libdir/plugins.
CMD ["postgres", "-c", "shared_preload_libraries=age"]
