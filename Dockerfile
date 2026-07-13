FROM node:22-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1

ARG DEBIAN_MIRROR_URL
ARG DEBIAN_SECURITY_MIRROR_URL
RUN if [ -n "$DEBIAN_SECURITY_MIRROR_URL" ]; then \
      sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR_URL}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && if [ -n "$DEBIAN_MIRROR_URL" ]; then \
      sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR_URL}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

ARG NEXT_PUBLIC_SHANHAI_AUTH_MODE=password
ARG NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=0
ENV NEXT_PUBLIC_SHANHAI_AUTH_MODE=${NEXT_PUBLIC_SHANHAI_AUTH_MODE} \
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=${NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED}

RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1

ARG DEBIAN_MIRROR_URL
ARG DEBIAN_SECURITY_MIRROR_URL
RUN if [ -n "$DEBIAN_SECURITY_MIRROR_URL" ]; then \
      sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR_URL}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && if [ -n "$DEBIAN_MIRROR_URL" ]; then \
      sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR_URL}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fontconfig \
    fonts-noto-cjk \
    libreoffice-impress \
    poppler-utils \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node \
  /app/scripts/bootstrap-admin.mjs \
  /app/scripts/container-runtime-preflight.mjs \
  /app/scripts/init-sqlite-schema.mjs \
  /app/scripts/production-preflight.mjs \
  /app/scripts/release-data-recovery.mjs \
  ./scripts/
COPY --from=builder --chown=node:node /app/scripts/lib ./scripts/lib

RUN npm run preflight:container-runtime \
  && node -e "require('better-sqlite3')" \
  && test ! -d node_modules/prisma \
  && test ! -d node_modules/@prisma/dev \
  && test ! -d node_modules/@hono/node-server \
  && test ! -d node_modules/postcss

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3210

EXPOSE 3210
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
