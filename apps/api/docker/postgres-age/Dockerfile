# Postgres 16 + pgvector + Apache AGE (ADR-114).
#
# Base stays the image this repo already used (`pgvector/pgvector:pg16`), so pgvector is
# unchanged; AGE is compiled on top. The AGE source is pinned to a COMMIT, not a tag: tags
# on apache/age are movable release-candidate names, and "the graph extension silently
# changed under us" is exactly the drift ADR-114 says we must not allow. Upgrading AGE or
# the Postgres major is a deliberate edit of this file, validated by
# `tests/db/age-pgvector-extensions.test.ts` + `graph:rebuild` parity (F04).
FROM pgvector/pgvector:pg16

# PG16/v1.6.0-rc0
ARG AGE_COMMIT=2db2f060c4c9265a14d40f007eb8c56febf31e4c

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential ca-certificates git flex bison postgresql-server-dev-16; \
    git init /tmp/age; \
    git -C /tmp/age fetch --depth 1 https://github.com/apache/age.git "${AGE_COMMIT}"; \
    git -C /tmp/age checkout FETCH_HEAD; \
    make -C /tmp/age; \
    make -C /tmp/age install; \
    rm -rf /tmp/age; \
    apt-get purge -y --auto-remove build-essential git flex bison postgresql-server-dev-16; \
    rm -rf /var/lib/apt/lists/*

# AGE must be preloaded: with it in shared_preload_libraries a non-superuser session
# (the runtime role `app_rw`) can use the extension without `LOAD 'age'`, which is a
# superuser-only statement for libraries outside $libdir/plugins.
CMD ["postgres", "-c", "shared_preload_libraries=age"]
