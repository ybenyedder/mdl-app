# ==============================================================================
# MDL Connect — Dockerfile multi-stage (WASM Rust + SvelteKit Node + Runner PG17)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1 : Compilation du module Rust -> WebAssembly (wasm-pkg)
# ------------------------------------------------------------------------------
FROM rust:1-slim AS wasm-builder

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && ARCH="$(uname -m)" \
    && if [ "$ARCH" = "x86_64" ]; then \
         curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.128/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl.tar.gz" \
         | tar -xz --strip-components=1 -C /usr/local/bin wasm-bindgen-0.2.128-x86_64-unknown-linux-musl/wasm-bindgen; \
       elif [ "$ARCH" = "aarch64" ]; then \
         curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.128/wasm-bindgen-0.2.128-aarch64-unknown-linux-musl.tar.gz" \
         | tar -xz --strip-components=1 -C /usr/local/bin wasm-bindgen-0.2.128-aarch64-unknown-linux-musl/wasm-bindgen \
         || cargo install wasm-bindgen-cli --version 0.2.128 --locked -j 2; \
       else \
         cargo install wasm-bindgen-cli --version 0.2.128 --locked -j 2; \
       fi

COPY crates/mdl-wasm ./crates/mdl-wasm
COPY scripts/build-wasm.sh ./scripts/build-wasm.sh

RUN CARGO_BUILD_JOBS=1 cargo build \
      --manifest-path crates/mdl-wasm/Cargo.toml \
      --target wasm32-unknown-unknown \
      --release \
      --locked \
    && mkdir -p apps/web/src/lib/wasm-pkg \
    && wasm-bindgen \
      --target web \
      --out-dir apps/web/src/lib/wasm-pkg \
      crates/mdl-wasm/target/wasm32-unknown-unknown/release/mdl_wasm.wasm

# ------------------------------------------------------------------------------
# Stage 2 : Installation des dépendances et build SvelteKit (@mdl/web)
# ------------------------------------------------------------------------------
FROM node:24-slim AS node-builder

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm config set strict-dep-builds false \
    && pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY --from=wasm-builder /build/apps/web/src/lib/wasm-pkg ./apps/web/src/lib/wasm-pkg

RUN mkdir -p apps/web/drizzle \
    && pnpm --filter @mdl/web build \
    && ESBUILD="$(find node_modules/.pnpm -path '*/vite/node_modules/.bin/esbuild' | head -n1)" \
    && "$ESBUILD" apps/web/src/lib/server/db/seed.ts \
      --bundle --platform=node --format=esm --packages=external \
      --outfile=apps/web/build/seed.js \
    && CI=true pnpm prune --prod

# ------------------------------------------------------------------------------
# Stage 3 : Image finale légère et sécurisée (utilisateur non-root mdl)
# ------------------------------------------------------------------------------
FROM node:24-slim AS runner

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      postgresql-client \
      openssl \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Réutilise l'UID/GID 1000 pour éviter les soucis de droits sur WSL2/Linux
RUN userdel -r node 2>/dev/null || true \
    && groupdel node 2>/dev/null || true \
    && groupadd -g 1000 -r mdl \
    && useradd -u 1000 -r -g mdl -m -d /home/mdl -s /sbin/nologin mdl

COPY --from=node-builder /app/package.json ./package.json
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=node-builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=node-builder /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=node-builder /app/apps/web/build ./apps/web/build

RUN mkdir -p /app/data/uploads \
    && chown -R mdl:mdl /app

USER mdl

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/build"]
