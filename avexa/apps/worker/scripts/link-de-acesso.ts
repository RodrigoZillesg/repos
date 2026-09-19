/** Gera um link de acesso direto, sem passar pelo e-mail.
 *
 *  Mora no worker, e não no painel, porque é daqui que a operação roda: a
 *  imagem do worker é a única do deploy que tem as dependências instaladas
 *  para executar um script solto. Enquanto o Resend não estiver configurado
 *  em produção, este é o único jeito de entrar.
 *
 *      pnpm --filter @avexa/worker acesso rodrigo@platty.tech https://new.avexa.global
 */
import { emitirLinkDeAcesso } from '@avexa/servicos'

const email = (process.argv[2] ?? '').trim().toLowerCase()
const base = process.argv[3] ?? 'http://localhost:3000'

if (!email) {
  console.error('uso: pnpm --filter @avexa/worker acesso <email> [baseUrl]')
  process.exit(1)
}

const emitido = await emitirLinkDeAcesso(email, base)
if (!emitido) {
  console.error(`nenhum usuário ativo com o e-mail ${email}`)
  process.exit(1)
}

console.log(emitido.link)
process.exit(0)
