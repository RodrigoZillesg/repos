/** Manutenção da equipe interna da Avexa.
 *
 *  O e-mail de um usuário é a chave de acesso ao painel — é para ele que o
 *  link mágico vai. Errar o endereço tranca a pessoa do lado de fora, e não há
 *  tela no painel para consertar isso. Daí esta ferramenta.
 *
 *      pnpm --filter @avexa/worker equipe listar
 *      pnpm --filter @avexa/worker equipe email <atual> <novo>
 */
import { eq } from 'drizzle-orm'
import { db, usuario } from '@avexa/db'

const [comando, ...resto] = process.argv.slice(2)
const d = db()

const normalizar = (v: string) => v.trim().toLowerCase()

if (comando === 'listar') {
  const todos = await d.select().from(usuario)
  if (todos.length === 0) {
    console.log('nenhum usuário cadastrado')
    process.exit(0)
  }
  for (const u of todos) {
    console.log(`${u.ativo ? ' ' : '(inativo) '}${u.email}  —  ${u.nome}, ${u.papel}`)
  }
  process.exit(0)
}

if (comando === 'email') {
  const atual = normalizar(resto[0] ?? '')
  const novo = normalizar(resto[1] ?? '')

  if (!atual.includes('@') || !novo.includes('@')) {
    console.error('uso: pnpm --filter @avexa/worker equipe email <atual> <novo>')
    process.exit(1)
  }

  const [alvo] = await d.select().from(usuario).where(eq(usuario.email, atual)).limit(1)
  if (!alvo) {
    console.error(`nenhum usuário com o e-mail ${atual}`)
    process.exit(1)
  }

  // Dois usuários com o mesmo e-mail tornam ambíguo para quem o link de acesso
  // vale. O banco recusaria, mas a mensagem daqui é mais útil que a dele.
  const [ocupado] = await d.select().from(usuario).where(eq(usuario.email, novo)).limit(1)
  if (ocupado && ocupado.id !== alvo.id) {
    console.error(`o e-mail ${novo} já pertence a ${ocupado.nome}`)
    process.exit(1)
  }

  await d.update(usuario).set({ email: novo }).where(eq(usuario.id, alvo.id))
  console.log(`${alvo.nome}: ${atual} -> ${novo}`)
  console.log('os links de acesso antigos continuam válidos até expirarem')
  process.exit(0)
}

console.error('uso: equipe listar | equipe email <atual> <novo>')
process.exit(1)
