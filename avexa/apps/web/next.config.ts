import type { NextConfig } from 'next'

const config: NextConfig = {
  // Os pacotes do monorepo são consumidos como fonte TypeScript, sem build
  // separado. É o que mantém um único lugar para cada regra.
  transpilePackages: ['@avexa/core', '@avexa/db', '@avexa/servicos', '@avexa/adapters'],
  typedRoutes: true,
  // Empacotamento mínimo para o contêiner. `next start` não serve o standalone;
  // o script `start` roda o servidor gerado, que é o que o Dockerfile executa.
  output: 'standalone',
}

export default config
