/** Atalho de desenvolvimento para o link de acesso.
 *
 *  Em produção o mesmo script mora no worker — é a única imagem do deploy com
 *  dependências instaladas para rodar um script solto. Aqui é só conveniência
 *  para quem já está com o painel aberto:
 *
 *      pnpm --filter @avexa/web acesso rodrigo.zillesg@platty.tech
 */
import { emitirLinkDeAcesso } from '@avexa/servicos'

const email = (process.argv[2] ?? '').trim().toLowerCase()
const base = process.argv[3] ?? 'http://localhost:3000'

if (!email) {
  console.error('uso: pnpm --filter @avexa/web acesso <email> [baseUrl]')
  process.exit(1)
}

const emitido = await emitirLinkDeAcesso(email, base)
if (!emitido) {
  console.error(`nenhum usuário ativo com o e-mail ${email}`)
  process.exit(1)
}

console.log(emitido.link)
process.exit(0)
