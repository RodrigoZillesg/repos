/** Apaga um cliente da Avexa para a ativação poder ser refeita.
 *
 *  O QUE ESTE SCRIPT NÃO FAZ, E POR QUÊ
 *
 *  Não devolve número nenhum ao Twilio e não apaga assistente nenhum na Vapi.
 *  Essas duas contas são o único lugar onde existe coisa real, e uma delas
 *  custa dinheiro por mês. Um script de limpeza que mexesse lá transformaria
 *  "refazer a ativação" em "perder o número", e o erro seria irreversível.
 *
 *  O número comprado volta para o POOL — livre, sem projeto, com o SID e as
 *  capacidades intactos. É o que permite refazer a ativação reaproveitando o
 *  número que já se pagou, em vez de comprar outro.
 *
 *  O assistente da Vapi fica onde está e o script imprime o id dele. Refazer a
 *  ativação cria um assistente NOVO, então o antigo vira órfão: quem decide se
 *  apaga é uma pessoa, olhando o console da Vapi.
 *
 *  Lead, execução, tentativa e entrega saem junto por cascade. Num cliente
 *  recém-ativado isso é zero ou quase; o script conta antes de apagar, e
 *  recusa quando há lead de verdade, a não ser que se insista.
 *
 *      pnpm --filter @avexa/worker remover <slug>           # mostra o que faria
 *      pnpm --filter @avexa/worker remover <slug> --apagar  # apaga
 */
import { eq, inArray, sql } from 'drizzle-orm'
import {
  agenteVoz,
  auditoria,
  cliente,
  db,
  execucao,
  fluxo,
  lead,
  numero,
  projeto,
  type Db,
} from '@avexa/db'

const d: Db = db()
const slug = process.argv[2]?.trim()
const apagar = process.argv.includes('--apagar')
const mesmoComLeads = process.argv.includes('--mesmo-com-leads')

if (!slug) {
  console.error('uso: remover <slug-do-cliente> [--apagar] [--mesmo-com-leads]')
  process.exit(1)
}

const [c] = await d.select().from(cliente).where(eq(cliente.slug, slug)).limit(1)
if (!c) {
  console.error(`nenhum cliente com o slug "${slug}"`)
  process.exit(1)
}

const projetos = await d.select({ id: projeto.id, nome: projeto.nome }).from(projeto).where(eq(projeto.clienteId, c.id))
const ids = projetos.map((p) => p.id)

const nums = ids.length
  ? await d.select().from(numero).where(inArray(numero.projetoId, ids))
  : []
const agentes = ids.length
  ? await d.select().from(agenteVoz).where(inArray(agenteVoz.projetoId, ids))
  : []
const fluxos = ids.length ? await d.select().from(fluxo).where(inArray(fluxo.projetoId, ids)) : []
const [{ n: leads } = { n: 0 }] = await d
  .select({ n: sql<number>`count(*)::int` })
  .from(lead)
  .where(eq(lead.clienteId, c.id))
const [{ n: execucoes } = { n: 0 }] = await d
  .select({ n: sql<number>`count(*)::int` })
  .from(execucao)
  .where(eq(execucao.clienteId, c.id))

console.log(`== ${c.nome} (${c.slug}) ==\n`)
console.log(`projetos:   ${projetos.map((p) => p.nome).join(', ') || 'nenhum'}`)
console.log(`fluxos:     ${fluxos.length}`)
console.log(`leads:      ${leads}`)
console.log(`execuções:  ${execucoes}`)

console.log('\n-- fica no Twilio, volta para o pool --')
if (nums.length === 0) console.log('   nenhum número atribuído')
for (const n of nums) {
  console.log(
    `   ${n.e164} · SID ${n.provedorSid ?? 'nenhum (número de teste)'} · ` +
      `${n.provedorSid ? 'COMPRADO DE VERDADE, continua custando' : 'não custa nada'}`,
  )
}

console.log('\n-- fica na Vapi, intocado --')
if (agentes.length === 0) console.log('   nenhum agente de voz')
for (const a of agentes) {
  console.log(
    a.vapiAssistantId
      ? `   assistente ${a.vapiAssistantId} ("${a.nome}") — vira órfão; apague à mão se quiser`
      : `   "${a.nome}" nunca foi publicado: não há nada na Vapi`,
  )
}

if (leads > 0 && !mesmoComLeads) {
  console.error(
    `\nRECUSADO: este cliente tem ${leads} lead(s). Apagar leva junto o histórico de gente real.\n` +
      'Se é mesmo isso que você quer, repita com --mesmo-com-leads.',
  )
  process.exit(1)
}

if (!apagar) {
  console.log('\nNada foi apagado. Para apagar de verdade, repita com --apagar.')
  process.exit(0)
}

// O número sai do projeto ANTES do cliente ir embora. A FK é `set null`, então
// ele sobreviveria de qualquer jeito — mas ficaria com status "atribuido" e
// sem dono, que é um estado que nenhuma tela sabe explicar.
for (const n of nums) {
  await d
    .update(numero)
    .set({ projetoId: null, status: 'livre', assistenteId: null })
    .where(eq(numero.id, n.id))
  console.log(`devolvido ao pool: ${n.e164}`)
}

// A auditoria é o registro de quem fez o quê; ela perde o vínculo mas fica.
await d.update(auditoria).set({ clienteId: null }).where(eq(auditoria.clienteId, c.id))

await d.delete(cliente).where(eq(cliente.id, c.id))
console.log(`\napagado: ${c.nome} (${c.slug}). O slug está livre para refazer a ativação.`)
process.exit(0)
