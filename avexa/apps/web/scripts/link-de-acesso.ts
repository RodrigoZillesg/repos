/** Gera um link de acesso direto, sem passar pelo e-mail.
 *
 *  Em desenvolvimento o Resend normalmente não está configurado, e o link só
 *  apareceria no log do servidor. Este script encurta o caminho:
 *
 *      pnpm --filter @avexa/web acesso rodrigo@platty.tech
 */
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, tokenAcesso, usuario } from '@avexa/db'

const email = (process.argv[2] ?? '').trim().toLowerCase()
const base = process.argv[3] ?? 'http://localhost:3000'

if (!email) {
  console.error('uso: pnpm --filter @avexa/web acesso <email> [baseUrl]')
  process.exit(1)
}

const d = db()
const [u] = await d.select().from(usuario).where(eq(usuario.email, email)).limit(1)
if (!u) {
  console.error(`nenhum usuário com o e-mail ${email}`)
  process.exit(1)
}

const bruto = randomBytes(32).toString('base64url')
await d.insert(tokenAcesso).values({
  usuarioId: u.id,
  tokenHash: createHash('sha256').update(bruto).digest('hex'),
  expiraEm: new Date(Date.now() + 15 * 60_000),
})

console.log(`${base}/entrar/confirmar?t=${bruto}`)
process.exit(0)
