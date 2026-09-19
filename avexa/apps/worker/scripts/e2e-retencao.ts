/** Expurgo por retenção, contra o banco de verdade.
 *
 *  Uma política de retenção que apaga a coisa errada é pior do que não ter
 *  política. O que este script prova:
 *
 *   - a SUPRESSÃO SOBREVIVE. Quem pediu para parar continua bloqueado depois de
 *     o lead dele ser apagado. Se isso quebrar, o expurgo vira autorização para
 *     contatar de novo quem já disse não — o pior erro possível neste produto.
 *   - lead em andamento não é apagado no meio do percurso.
 *   - a gravação sai e a linha da chamada fica: duração e "aviso emitido" são a
 *     prova de que a ligação aconteceu do jeito certo.
 *   - retenção zero, que é o padrão, não apaga nada. */
import { and, eq, inArray } from 'drizzle-orm'
import {
  chamada,
  cliente,
  configGlobal,
  db,
  execucao,
  lead as tLead,
  pessoa,
  tentativa,
} from '@avexa/db'
import {
  encerrarFila,
  estaSuprimido,
  expurgar,
  ingerirLead,
  resumoDoExpurgo,
  suprimir,
} from '@avexa/servicos'

process.env.APP_SECRET ??= 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres'

const d = db()
const [c] = await d.select().from(cliente).where(eq(cliente.slug, 'ihte')).limit(1)
if (!c) {
  console.error('rode o seed antes')
  process.exit(1)
}

const problemas: string[] = []
const AGORA = new Date('2026-09-19T12:00:00Z')
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000)

/** Ingere e envelhece o lead, que é o que o tempo faria. */
async function leadDe(nome: string, telefone: string, email: string, idade: number) {
  const r = await ingerirLead(
    d,
    {
      clienteSlug: 'ihte',
      fluxoSlug: 'lead-novo',
      dados: { 'Full Name': nome, Phone: telefone, 'E-mail': email },
    },
    AGORA,
  )
  if (!r.aceito) throw new Error(`lead ${nome} recusado: ${r.motivo}`)
  await d.update(tLead).set({ criadoEm: diasAtras(idade) }).where(eq(tLead.id, r.leadId))
  await d.update(pessoa).set({ criadoEm: diasAtras(idade) }).where(
    eq(pessoa.id, (await d.select().from(tLead).where(eq(tLead.id, r.leadId)).limit(1))[0]!.pessoaId),
  )
  return r
}

// Quatro leads: um velho e encerrado, um velho e em andamento, um novo, e um
// velho de alguém que pediu para parar.
const velho = await leadDe('Velho Encerrado', '+61400000101', 'velho@exemplo.com', 400)
const andando = await leadDe('Velho Em Andamento', '+61400000102', 'andando@exemplo.com', 400)
const novo = await leadDe('Recente', '+61400000103', 'novo@exemplo.com', 5)
const optout = await leadDe('Pediu Para Parar', '+61400000104', 'optout@exemplo.com', 400)

await d
  .update(execucao)
  .set({ estado: 'concluida', motivoEncerramento: 'Não respondeu' })
  .where(inArray(execucao.leadId, [velho.leadId, optout.leadId]))
await d.update(execucao).set({ estado: 'aguardando' }).where(eq(execucao.leadId, andando.leadId))
await d.update(execucao).set({ estado: 'concluida' }).where(eq(execucao.leadId, novo.leadId))

// Quem pediu para parar: a supressão é gravada pelo valor, não pela pessoa.
await suprimir(
  d,
  { telefone: '+61400000104', email: 'optout@exemplo.com' },
  { motivo: 'pediu para parar', clienteId: c.id },
)

// Uma ligação velha com gravação e transcrição, e uma recente.
const [ld] = await d.select().from(tLead).where(eq(tLead.id, velho.leadId)).limit(1)
async function chamadaDe(leadId: string, idade: number) {
  const [t] = await d
    .insert(tentativa)
    .values({
      execucaoId: (await d.select().from(execucao).where(eq(execucao.leadId, leadId)).limit(1))[0]!.id,
      leadId,
      clienteId: c!.id,
      fluxoId: ld!.fluxoId,
      pessoaId: (await d.select().from(tLead).where(eq(tLead.id, leadId)).limit(1))[0]!.pessoaId,
      etapaId: 'lig-1',
      canal: 'ligacao',
      destinatario: '+61400000101',
      estado: 'enviada',
      agendadaPara: diasAtras(idade),
    })
    .returning({ id: tentativa.id })
  const [ch] = await d
    .insert(chamada)
    .values({
      tentativaId: t!.id,
      atendida: true,
      duracaoSegundos: 83,
      gravacaoUrl: 'https://gravacoes.vapi.ai/abc.mp3',
      transcricao: 'Oi Ana, aqui é da escola…',
      avisoGravacaoEmitido: true,
      criadoEm: diasAtras(idade),
    })
    .returning({ id: chamada.id })
  return ch!.id
}
const gravacaoVelha = await chamadaDe(novo.leadId, 200)
const gravacaoNova = await chamadaDe(novo.leadId, 3)

// 1. Padrão: retenção zero não apaga nada.
await d.update(configGlobal).set({ retencaoLeadDias: 0, retencaoGravacaoDias: 0 })
const nada = await expurgar(d, AGORA)
const totalAntes = (await d.select({ id: tLead.id }).from(tLead)).length
console.log(`1. retenção desligada: ${resumoDoExpurgo(nada)}`)
if (nada.leadsApagados !== 0 || nada.gravacoesLimpas !== 0) {
  problemas.push('apagou algo com a retenção desligada')
}

// 2. Com política: 365 dias de lead, 90 de gravação.
await d.update(configGlobal).set({ retencaoLeadDias: 365, retencaoGravacaoDias: 90 })
const r = await expurgar(d, AGORA)
console.log(`2. expurgo: ${resumoDoExpurgo(r)}`)

const existe = async (id: string) =>
  (await d.select({ id: tLead.id }).from(tLead).where(eq(tLead.id, id))).length > 0

const sobrouVelho = await existe(velho.leadId)
const sobrouAndando = await existe(andando.leadId)
const sobrouNovo = await existe(novo.leadId)
const sobrouOptout = await existe(optout.leadId)
console.log(
  `   velho=${sobrouVelho ? 'ficou' : 'apagado'} · em andamento=${sobrouAndando ? 'ficou' : 'apagado'} · recente=${sobrouNovo ? 'ficou' : 'apagado'} · opt-out=${sobrouOptout ? 'ficou' : 'apagado'}`,
)
if (sobrouVelho) problemas.push('lead velho e encerrado não foi apagado')
if (!sobrouAndando) problemas.push('apagou lead que ainda estava no meio do fluxo')
if (!sobrouNovo) problemas.push('apagou lead dentro da janela de retenção')
if (sobrouOptout) problemas.push('lead velho de quem pediu parar não foi apagado')
if (r.leadsEmAndamento !== 1) problemas.push('não contou o lead preservado por estar em andamento')
if (totalAntes - r.leadsApagados < 0) problemas.push('contagem de apagados incoerente')

// 3. O que mais importa: a supressão sobreviveu ao expurgo.
const aindaSuprimido = await estaSuprimido(d, {
  telefone: '+61400000104',
  email: 'optout@exemplo.com',
})
console.log(`3. quem pediu para parar continua bloqueado: ${aindaSuprimido}`)
if (!aindaSuprimido) {
  problemas.push('O EXPURGO LIBEROU QUEM PEDIU PARA PARAR — é o pior erro possível aqui')
}

// 4. Gravação velha sai, linha da chamada fica.
const [chVelha] = await d.select().from(chamada).where(eq(chamada.id, gravacaoVelha)).limit(1)
const [chNova] = await d.select().from(chamada).where(eq(chamada.id, gravacaoNova)).limit(1)
console.log(
  `4. gravação velha: url=${chVelha?.gravacaoUrl ?? 'nula'} · duração=${chVelha?.duracaoSegundos}s · aviso=${chVelha?.avisoGravacaoEmitido}`,
)
console.log(`   gravação recente: url=${chNova?.gravacaoUrl ? 'preservada' : 'NULA'}`)
if (!chVelha) problemas.push('a linha da chamada velha sumiu junto com a gravação')
if (chVelha?.gravacaoUrl !== null || chVelha?.transcricao !== null) {
  problemas.push('a gravação velha não foi limpa')
}
if (chVelha?.duracaoSegundos !== 83 || chVelha?.avisoGravacaoEmitido !== true) {
  problemas.push('perdeu a prova de que a ligação aconteceu do jeito certo')
}
if (!chNova?.gravacaoUrl) problemas.push('limpou gravação dentro da janela de retenção')
if (r.gravacoesLimpas !== 1) problemas.push(`esperava 1 gravação limpa, veio ${r.gravacoesLimpas}`)

// 5. Rodar de novo não apaga o que já foi apagado nem inventa trabalho.
const denovo = await expurgar(d, AGORA)
console.log(`5. segunda passada: ${resumoDoExpurgo(denovo)}`)
if (denovo.leadsApagados !== 0 || denovo.gravacoesLimpas !== 0) {
  problemas.push('a segunda passada mexeu em algo — o expurgo não é idempotente')
}

// Deixa o banco como estava, para o próximo e2e não herdar política de retenção.
await d.update(configGlobal).set({ retencaoLeadDias: 0, retencaoGravacaoDias: 0 })

console.log('')
if (problemas.length > 0) {
  console.log('❌ FALHOU:')
  for (const p of problemas) console.log(`   ${p}`)
} else {
  console.log('✅ supressão sobrevive ao expurgo, lead em andamento preservado,')
  console.log('   gravação limpa sem perder o registro da ligação, e expurgo idempotente')
}
await encerrarFila()
process.exit(problemas.length > 0 ? 1 : 0)
