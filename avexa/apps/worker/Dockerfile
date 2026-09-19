# Imagem do worker. O monorepo inteiro entra porque os pacotes são consumidos
# como fonte TypeScript, executada pelo tsx — sem passo de build separado.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/adapters/package.json packages/adapters/
COPY packages/ia/package.json packages/ia/
COPY packages/servicos/package.json packages/servicos/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS runtime
# Rótulo para a limpeza pós-deploy não encostar em imagem de outro projeto
# que divida esta máquina.
LABEL projeto=avexa
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY . .

ENV NODE_ENV=production
# Encerramento com calma: o SIGTERM precisa chegar ao processo Node, não ao shell.
STOPSIGNAL SIGTERM
CMD ["pnpm", "--filter", "@avexa/worker", "start"]
