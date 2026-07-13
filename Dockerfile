FROM node:22-bookworm-slim

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
    g++ \
    make \
    poppler-utils \
    python3 \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
USER root
RUN apt-get purge -y --auto-remove python3 make g++
USER node

COPY --chown=node:node . .

ARG NEXT_PUBLIC_SHANHAI_AUTH_MODE=password
ARG NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=0
ENV NEXT_PUBLIC_SHANHAI_AUTH_MODE=${NEXT_PUBLIC_SHANHAI_AUTH_MODE} \
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=${NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED}

RUN npm run build \
  && mkdir -p .next/standalone/.next \
  && cp -R public .next/standalone/public \
  && cp -R .next/static .next/standalone/.next/static \
  && npm run preflight:container-runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3210

EXPOSE 3210
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".next/standalone/server.js"]
