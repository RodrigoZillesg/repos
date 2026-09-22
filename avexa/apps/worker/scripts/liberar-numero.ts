/** Devolve um número ao Twilio, de verdade.
 *
 *  ISTO NÃO ECONOMIZA O MÊS CORRENTE. O Twilio cobra o mês inteiro no ato da
 *  compra e não faz proporcional: comprar e soltar no mesmo dia custa um mês.
 *  Dá para reclamar o número no console por dez dias, mas o ciclo de cobrança
 *  recomeça. Então soltar e recomprar para cada teste custa um mês por teste.
 *
 *  Para testar muitas vezes, o caminho barato é outro: UM número que circula
 *  pelo pool. `remover <cliente>` devolve o número ao pool com o SID intacto, e
 *  a ativação seguinte pega o mesmo. Custo: um número, para sempre.
 *
 *  Este script existe para o caso legítimo de se livrar de um número errado —
 *  país trocado, tipo errado — não para o ciclo de teste.
 *
 *      pnpm --filter @avexa/worker liberar <e164>            # mostra o que faria
 *      pnpm --filter @avexa/worker liberar <e164> --liberar  # solta de verdade
 */
import { eq } from 'drizzle-orm'
import { cliente, db, numero, projeto } from '@avexa/db'
import { liberarNumero } from '@avexa/adapters'
import { credenciaisDoAmbiente } from '@avexa/servicos'

const d = db()
const e164 = process.argv[2]?.trim()
const confirmar = process.argv.includes('--liberar')

if (!e164) {
  console.error('uso: liberar <e164> [--liberar]')
  process.exit(1)
}

const [n] = await d
  .select({
    id: numero.id,
    e164: numero.e164,
    sid: numero.provedorSid,
    status: numero.status,
    projetoId: numero.projetoId,
    projeto: projeto.nome,
    cliente: cliente.nome,
  })
  .from(numero)
  .leftJoin(projeto, eq(numero.projetoId, projeto.id))
  .leftJoin(cliente, eq(projeto.clienteId, cliente.id))
  .where(eq(numero.e164, e164))
  .limit(1)

if (!n) {
  console.error(`${e164} não está na nossa tabela. Se ele existe no Twilio, solte pelo console.`)
  process.exit(1)
}

console.log(`${n.e164} · ${n.status} · SID ${n.sid ?? 'nenhum'}`)
if (n.cliente) console.log(`em uso por: ${n.cliente} · ${n.projeto}`)

if (!n.sid) {
  console.error('\nEste número não tem SID: nunca foi comprado por nós e não existe no Twilio.')
  console.error('Não há o que liberar. Para tirá-lo da nossa tabela, apague a linha.')
  process.exit(1)
}

// Soltar um número que um projeto está usando deixa o cliente mudo sem aviso:
// o canal continua ligado, a etapa continua no fluxo, e o envio morre.
if (n.projetoId) {
  console.error(
    `\nRECUSADO: ${n.e164} está atribuído a ${n.cliente} · ${n.projeto}.\n` +
      'Remova o cliente (ou troque o número dele) antes de soltar. Soltar agora deixaria\n' +
      'o projeto com um número que não existe mais, e os contatos morreriam em silêncio.',
  )
  process.exit(1)
}

console.log('\nO que acontece ao liberar:')
console.log('  · o número sai da sua conta do Twilio e volta para o mercado;')
console.log('  · o mês já pago NÃO é devolvido — o Twilio não faz proporcional;')
console.log('  · dá para reclamar no console por 10 dias, mas a cobrança recomeça;')
console.log('  · na prática, recuperá-lo depois é comprar de novo.')

if (!confirmar) {
  console.log('\nNada foi feito. Para liberar de verdade, repita com --liberar.')
  process.exit(0)
}

const cred = credenciaisDoAmbiente()
if (!cred) {
  console.error('\nfaltam TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN no ambiente')
  process.exit(1)
}

const r = await liberarNumero(cred, n.sid)
if (!r.ok) {
  console.error(`\nfalhou: ${r.erro}`)
  process.exit(1)
}

// Só sai da nossa tabela depois que o Twilio confirmou. Na ordem inversa, uma
// falha lá deixaria um número que existe e que nós não sabemos que temos.
await d.delete(numero).where(eq(numero.id, n.id))
console.log(`\nliberado: ${n.e164}. Saiu do Twilio e da nossa tabela.`)
process.exit(0)
