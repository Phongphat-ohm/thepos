FROM oven/bun:1.3.11
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/shared packages/shared
COPY apps/desktop/index.html apps/desktop/vite.config.ts apps/desktop/tsconfig.json apps/desktop/
COPY apps/desktop/public apps/desktop/public
COPY apps/desktop/src apps/desktop/src
COPY apps/server/src apps/server/src
COPY apps/server/prisma apps/server/prisma
RUN bun run db:generate && bun run --cwd apps/desktop build
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
USER bun
EXPOSE 3000
CMD ["sh", "-ec", "cd /app/apps/server && exec bun src/index.ts"]
