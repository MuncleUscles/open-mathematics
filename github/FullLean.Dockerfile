# Trusted dependency installation only. Contributor code is never present here.
FROM ubuntu@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git zstd python3 \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 -o /tmp/lean.tar.zst https://github.com/leanprover/lean4/releases/download/v4.36.0/lean-4.36.0-linux.tar.zst \
    && echo '2b7ab1ed8b92d2e6abfaf41344823b510064dbc9c0260cac73eb496ab2dea6eb  /tmp/lean.tar.zst' | sha256sum --check \
    && mkdir -p /opt/lean && tar --zstd -xf /tmp/lean.tar.zst --strip-components=1 -C /opt/lean \
    && rm /tmp/lean.tar.zst
ENV PATH="/opt/lean/bin:${PATH}"
RUN mkdir -p /opt/full-lean && cd /opt/full-lean && git init \
    && git remote add origin https://github.com/leanprover-community/mathlib4.git \
    && git fetch --depth=1 origin fc4f59e577feb1a4956671bc04ac18aaaf8cd842 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = fc4f59e577feb1a4956671bc04ac18aaaf8cd842 \
    && test "$(cat lean-toolchain)" = leanprover/lean4:v4.36.0 \
    && lake exe cache get \
    && rm -rf /root/.cache/mathlib \
    && chmod -R a+rX /opt/full-lean
WORKDIR /opt/full-lean
USER 65534:65534
