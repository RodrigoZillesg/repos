/** Prova de que a supressão é global de verdade.
 *
 *  Um lead pede para parar no SMS de um cliente. O mesmo telefone chega depois
 *  pelo formulário de OUTRO cliente. Nenhum contato pode sair. É a regra mais
 *  forte do produto e a que, se falhar, falha silenciosamente. */
import { eq } from 'drizzle-orm'
import { db, execucao, supressao, tentativa } from '@avexa/db'
import { ingerirLead, encerrarFila } from '@avexa/servicos'
import { adaptadoresDoAmbiente } from '@avexa/adapters'
import { avancarExecucao } from '../src/executor.ts'
import { processarEvento } from '../src/eventos.ts'
import type { Ambiente } from '../src/contexto.ts'

const d = db()
const relogio = new Date('2026-03-10T23:00:00Z') // 10:00 em Sydney

const amb: Ambiente = {
  db: d,
  adaptadores: adaptadoresDoAmbiente(),
  ia: null,
  agora: () => relogio,
}

const TELEFONE = '0412 999 888'

// 1. Lead entra pelo International House e recebe o primeiro contato.
const a = await ingerirLead(
  d,
  { clienteSlug: 'ihte', fluxoSlug: 'lead-novo', dados: { nome: 'Bruno', telefone: TELEFONE, email: 'bruno@exemplo.com' } },
  relogio,
)
if (!a.aceito) throw new Error(`recusado: ${a.motivo}`)
await avancarExecucao(amb, a.execucaoId)

const primeiras = await d.select().from(tentativa).where(eq(tentativa.execucaoId, a.execucaoId))
console.log(`1. International House contatou: ${primeiras.map((t) => t.canal).join(', ')}`)

// 2. O lead responde PARAR por SMS. Chega como webhook do Twilio.
const alvo = primeiras.find((t) => t.canal === 'ligacao') ?? primeiras[0]!
await d.update(tentativa).set({ canal: 'sms', provedorId: 'SM_TESTE' }).where(eq(tentativa.id, alvo.id))

const n = await processarEvento(
  amb,
  'sms',
  { MessageSid: 'SM_TESTE', From: '+61412999888', Body: 'PARAR' },
  {},
)
console.log(`2. Webhook do Twilio interpretado: ${n} evento(s)`)

const listadas = await d.select().from(supressao)
console.log(`3. Supressão gravada: ${listadas.map((s) => `${s.tipo}=${s.valor}`).join(' · ')}`)

// A resposta enfileira um avanço imediato; aqui o script faz o papel do worker.
await avancarExecucao(amb, a.execucaoId)
const [exA] = await d.select().from(execucao).where(eq(execucao.id, a.execucaoId)).limit(1)
console.log(`4. Execução do International House: ${exA!.estado} · ${exA!.motivoEncerramento}`)

// 3. O MESMO telefone chega pelo formulário de outro cliente.
const b = await ingerirLead(
  d,
  { clienteSlug: 'lbird', fluxoSlug: 'lead-novo', dados: { nome: 'Bruno', telefone: TELEFONE, email: 'outro@exemplo.com' } },
  relogio,
)
if (!b.aceito) throw new Error(`recusado: ${b.motivo}`)
await avancarExecucao(amb, b.execucaoId)

const segundas = await d.select().from(tentativa).where(eq(tentativa.execucaoId, b.execucaoId))
const [exB] = await d.select().from(execucao).where(eq(execucao.id, b.execucaoId)).limit(1)

console.log('')
console.log('5. LanguageBird, mesmo telefone, cliente diferente:')
for (const t of segundas) {
  console.log(`   ${t.canal.padEnd(9)} ${t.estado.padEnd(10)} motivo: ${t.motivo ?? '—'}`)
}
console.log(`   execução: ${exB!.estado} · ${exB!.motivoEncerramento}`)

const enviou = segundas.some((t) => t.estado === 'enviada')
console.log('')
console.log(enviou ? '❌ FALHOU: saiu contato para quem pediu para parar' : '✅ nenhum contato saiu')
await encerrarFila()
process.exit(enviou ? 1 : 0)
