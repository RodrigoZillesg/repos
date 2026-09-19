# Painel Avexa. O standalone do Next carrega só o que as rotas realmente usam,
# então a imagem final não leva o monorepo inteiro.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @avexa/web build

FROM base AS runtime
# Rótulo para a limpeza pós-deploy não encostar em imagem de outro projeto
# que divida esta máquina.
LABEL projeto=avexa
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
