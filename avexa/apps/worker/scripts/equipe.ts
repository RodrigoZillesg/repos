/** Manutenção da equipe interna da Avexa.
 *
 *  O e-mail de um usuário é a chave de acesso ao painel — é para ele que o
 *  link mágico vai. Errar o endereço tranca a pessoa do lado de fora, e não há
 *  tela no painel para consertar isso. Daí esta ferramenta.
 *
 *      pnpm --filter @avexa/worker equipe listar
 *      pnpm --filter @avexa/worker equipe email <atual> <novo>
 *      pnpm --filter @avexa/worker equipe remover <email>
 */
import { count, eq } from 'drizzle-orm'
import { auditoria, db, usuario } from '@avexa/db'

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

if (comando === 'remover') {
  const alvoEmail = normalizar(resto[0] ?? '')
  if (!alvoEmail.includes('@')) {
    console.error('uso: pnpm --filter @avexa/worker equipe remover <email>')
    process.exit(1)
  }

  const [alvo] = await d.select().from(usuario).where(eq(usuario.email, alvoEmail)).limit(1)
  if (!alvo) {
    console.error(`nenhum usuário com o e-mail ${alvoEmail}`)
    process.exit(1)
  }

  // A trilha de auditoria é o que prova que a separação de papéis foi
  // cumprida — papel designer e copywriter não veem dado de lead. Apagar o
  // usuário põe `usuarioId` em null e transforma "o Fulano publicou isso" em
  // "alguém publicou isso". Quem já agiu é desativado, não apagado.
  const [linha] = await d
    .select({ n: count() })
    .from(auditoria)
    .where(eq(auditoria.usuarioId, alvo.id))
  const acoes = linha?.n ?? 0

  if (acoes > 0) {
    await d.update(usuario).set({ ativo: false }).where(eq(usuario.id, alvo.id))
    console.log(`${alvo.nome} desativado (tem ${acoes} ação na auditoria, então não se apaga)`)
    console.log('sem acesso ao painel: o pedido de link ignora usuário inativo')
    process.exit(0)
  }

  // Sessões e tokens saem em cascata junto.
  await d.delete(usuario).where(eq(usuario.id, alvo.id))
  console.log(`${alvo.nome} <${alvoEmail}> removido`)
  process.exit(0)
}

console.error('uso: equipe listar | equipe email <atual> <novo> | equipe remover <email>')
process.exit(1)
