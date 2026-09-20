/** Republica na Vapi todos os agentes já publicados.
 *
 *  Existe por causa do segredo do webhook: o desfecho da ligação passou a ser
 *  conferido por `x-vapi-secret`, e um agente publicado antes disso manda o
 *  relatório sem segredo. A Avexa descarta, e a ligação acontece sem nunca
 *  virar evento — o lead atende, conversa, e o fluxo fica parado esperando um
 *  desfecho que já veio e foi jogado fora.
 *
 *  Republicar é a correção: o PATCH leva o segredo e a URL atuais para o
 *  assistente que já existe lá.
 *
 *      pnpm --filter @avexa/worker publicar-agentes
 */
import { eq, isNotNull } from 'drizzle-orm'
import { agenteVoz, cliente, db } from '@avexa/db'
import {
  credenciaisVapiDoAmbiente,
  publicarAgente,
  segredoDoWebhookDeVoz,
  webhookDeLigacao,
} from '@avexa/servicos'

const cred = credenciaisVapiDoAmbiente()
if (!cred) {
  console.error('VAPI_API_KEY não está configurada neste servidor.')
  process.exit(1)
}

const webhook = webhookDeLigacao()
const segredo = segredoDoWebhookDeVoz()

if (!segredo) {
  // Sem APP_SECRET forte não há segredo derivado, e republicar deixaria os
  // agentes exatamente como estão. Melhor dizer isso do que fingir sucesso.
  console.error('APP_SECRET ausente ou curto: não há segredo de webhook para publicar.')
  process.exit(1)
}

console.log(`webhook: ${webhook}`)
console.log(`segredo: presente (${segredo.length} caracteres, não mostrado)\n`)

const d = db()
const agentes = await d
  .select({
    id: agenteVoz.id,
    nome: agenteVoz.nome,
    clienteNome: cliente.nome,
    vapiAssistantId: agenteVoz.vapiAssistantId,
  })
  .from(agenteVoz)
  .innerJoin(cliente, eq(agenteVoz.clienteId, cliente.id))
  // Só quem já está no ar. Agente nunca publicado é rascunho: publicá-lo aqui
  // poria no ar um prompt que ninguém revisou.
  .where(isNotNull(agenteVoz.vapiAssistantId))

if (agentes.length === 0) {
  console.log('Nenhum agente publicado. Nada a republicar.')
  process.exit(0)
}

let falhas = 0
for (const a of agentes) {
  const r = await publicarAgente(d, a.id, cred, webhook, segredo)
  if (r.ok) {
    console.log(`  ok     ${a.clienteNome} · ${a.nome} (${r.vapiAssistantId})`)
  } else {
    falhas++
    console.log(`  FALHOU ${a.clienteNome} · ${a.nome}: ${r.erro}`)
  }
}

console.log(`\n${agentes.length - falhas} de ${agentes.length} republicados.`)
// Sai com erro quando algum ficou para trás: no log do Actions, um job verde
// com falha no meio é uma falha que ninguém vê.
process.exit(falhas > 0 ? 1 : 0)
