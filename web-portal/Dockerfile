FROM oven/bun:1.3.11-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN bun install

COPY index.html tsconfig.json vite.config.ts ./
COPY src/ src/

RUN bun run build

FROM caddy:2.8-alpine
COPY --from=builder /app/dist /srv/web
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
