FROM oven/bun:1.3.11
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/server/src apps/server/src
COPY apps/server/prisma apps/server/prisma
RUN bun run db:generate
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000 AUTO_HTTPS=false
USER bun
EXPOSE 3000
CMD ["sh", "-ec", "cd /app/apps/server && exec bun src/index.ts"]
