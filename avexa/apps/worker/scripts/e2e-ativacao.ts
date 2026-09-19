/** Ativação de um cliente do zero, e o lead de teste atravessando o que ela criou.
 *
 *  É a promessa comercial do produto em forma de script: cliente novo no ar sem
 *  criar conta, sem cadastrar cartão, sem tocar em DNS — só a URL de webhook.
 *  O passo 9 da própria sequência ("rodar o lead de teste") é o que este arquivo
 *  faz depois de provisionar. */
import { eq } from 'drizzle-orm'
import { cliente, db, execucao, numero, template, tentativa } from '@avexa/db'
import { ativarCliente, encerrarFila, ingerirLead } from '@avexa/servicos'
import { adaptadoresDoAmbiente } from '@avexa/adapters'
import { avancarExecucao } from '../src/executor.ts'
import type { Ambiente } from '../src/contexto.ts'

const d = db()
let relogio = new Date('2026-03-10T23:00:00Z') // 10:00 em Sydney, terça

const amb: Ambiente = {
  db: d,
  adaptadores: adaptadoresDoAmbiente(),
  ia: null,
  agora: () => new Date(relogio),
}

const SLUG = `teste-${Date.now().toString(36)}`
// Telefone único por rodada: a regra de um canal por janela vale para a pessoa
// em todos os clientes, então reusar o número faria a rodada seguinte ser adiada
// pela anterior — e o teste falharia por acerto do motor.
const TELEFONE = `+6141${String(Date.now()).slice(-7)}`

// O teste põe o próprio número no pool: depender das sobras do seed faria a
// segunda rodada falhar por esgotamento, o que não é o que se quer testar aqui.
await d.insert(numero).values({ e164: `+6125550${String(Date.now()).slice(-4)}` })

const r = await ativarCliente(d, {
  nome: 'Escola Teste',
  slug: SLUG,
  produto: 'cursos de inglês intensivo',
  setor: 'Escola de idiomas',
  fusoHorario: 'Australia/Sydney',
  canais: { ligacao: true, whatsapp: true, sms: true, email: true, telegram: false },
  emailDoTime: 'comercial@teste.exemplo.com',
  fluxosExtras: ['Confirmação de reunião'],
})

if (!r.ok) {
  console.error('ativação falhou:', r.erro)
  process.exit(1)
}

console.log('passos da ativação:')
for (const p of r.passos) {
  console.log(`  ${p.n}. ${p.estado.padEnd(7)} ${p.nome} — ${p.detalhe}`)
}
console.log('')
console.log('URLs para o cliente:')
for (const u of r.urls) console.log(`  ${u.fluxo.padEnd(24)} ${u.url}`)

// O que a ativação deixou de pé.
const [c] = await d.select().from(cliente).where(eq(cliente.id, r.clienteId!)).limit(1)
const modelos = await d.select().from(template).where(eq(template.clienteId, r.clienteId!))
const [voz] = await d.select().from(numero).where(eq(numero.clienteId, r.clienteId!)).limit(1)

console.log('')
console.log(`cliente: ${c!.nome} · ${c!.pais} · seco=${c!.dryRun} · status=${c!.status}`)
console.log(`templates: ${modelos.map((m) => `${m.canal}/${m.nome}(${m.status})`).join(' ')}`)
console.log(`número de voz: ${voz?.e164 ?? '—'}`)

// Passo 9: o lead de teste, ponta a ponta, pelo endereço que acabou de nascer.
console.log('')
console.log('lead de teste pela URL recém-criada:')
const lead = await ingerirLead(
  d,
  {
    clienteSlug: SLUG,
    fluxoSlug: 'lead-novo',
    dados: { nome: 'Lead de Teste', telefone: TELEFONE, email: `teste-${SLUG}@exemplo.com` },
  },
  relogio,
)
if (!lead.aceito) {
  console.error('  recusado:', lead.motivo)
  process.exit(1)
}

for (let i = 0; i < 30; i++) {
  await avancarExecucao(amb, lead.execucaoId)
  const [ex] = await d.select().from(execucao).where(eq(execucao.id, lead.execucaoId)).limit(1)
  if (!ex || ex.estado === 'concluida' || ex.estado === 'cancelada') break
  if (ex.estado === 'aguardando' && ex.retomarEm) relogio = ex.retomarEm
}

const linhas = await d
  .select()
  .from(tentativa)
  .where(eq(tentativa.execucaoId, lead.execucaoId))
  .orderBy(tentativa.criadoEm)

for (const t of linhas) {
  console.log(`  ${t.canal.padEnd(9)} ${t.estado.padEnd(10)} ${t.motivo ?? ''}`)
}

// O que precisa ser verdade para a ativação valer.
const enviados = linhas.filter((t) => t.estado === 'enviada').map((t) => t.canal)
const problemas: string[] = []
if (voz === undefined) problemas.push('nenhum número de voz reservado')
if (modelos.length === 0) problemas.push('nenhum template criado')
if (r.urls.length !== 2) problemas.push(`esperava 2 URLs, saíram ${r.urls.length}`)
if (!enviados.includes('ligacao')) problemas.push('a ligação não saiu')
// WhatsApp NÃO deve sair num cliente recém-ativado: o número é da marca Avexa,
// mas o template ainda espera a Meta. O que se exige é que a etapa tenha sido
// pulada pelo motivo certo, e que o fluxo tenha seguido pelos outros canais.
const wa = linhas.find((t) => t.canal === 'whatsapp')
if (wa?.motivo !== 'template_nao_aprovado') {
  problemas.push(`esperava o WhatsApp pulado por template não aprovado, veio: ${wa?.motivo ?? 'nada'}`)
}
if (!r.avisos.some((a) => a.includes('Meta'))) {
  problemas.push('a ativação não avisou que o WhatsApp ainda não dispara')
}
if (!enviados.includes('email')) problemas.push('o e-mail não saiu')
if (!linhas.every((t) => t.dryRun)) problemas.push('alguma tentativa saiu fora do modo seco')

console.log('')
console.log('avisos da ativação:')
for (const a of r.avisos) console.log(`  ⚠ ${a}`)

console.log('')
if (problemas.length > 0) {
  console.log('❌ FALHOU:')
  for (const p of problemas) console.log(`   ${p}`)
} else {
  console.log('✅ cliente no ar; lead de teste saiu por ligação e e-mail, WhatsApp')
  console.log('   corretamente pulado à espera da Meta, tudo em modo seco')
}

await encerrarFila()
process.exit(problemas.length > 0 ? 1 : 0)
