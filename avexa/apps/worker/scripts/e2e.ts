/** Lead de teste ponta a ponta, contra o banco de verdade.
 *
 *  É o passo 9 da ativação ("rodar o lead de teste") em forma de script: um
 *  contato real de ponta a ponta antes de abrir a torneira. O relógio é virtual,
 *  então uma espera de 24 horas não segura o script — mas ela é calculada pelas
 *  mesmas regras de janela que valem em produção. */
import { eq } from 'drizzle-orm'
import { db, execucao, lead, tentativa } from '@avexa/db'
import { ingerirLead, encerrarFila } from '@avexa/servicos'
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

const payload = {
  'Full Name': 'Ana Ribeiro',
  Phone: '0412 345 678',
  'E-mail': ' Ana.Ribeiro@Exemplo.COM ',
  curso: 'IELTS',
  unidade: 'Sydney CBD',
  utm_source: 'google-ads',
  utm_campaign: 'ielts-fev',
}

const r = await ingerirLead(d, {
  clienteSlug: 'ihte',
  fluxoSlug: 'lead-novo',
  dados: payload,
}, relogio)

if (!r.aceito) {
  console.error('lead recusado:', r.motivo)
  process.exit(1)
}

const [ld] = await d.select().from(lead).where(eq(lead.id, r.leadId)).limit(1)
console.log('lead:', ld!.nome, '|', ld!.telefone, '|', ld!.email)
console.log('utm :', JSON.stringify(ld!.utm))
console.log('')

// Avança até concluir, pulando o relógio para o vencimento de cada espera.
for (let i = 0; i < 30; i++) {
  await avancarExecucao(amb, r.execucaoId)
  const [ex] = await d.select().from(execucao).where(eq(execucao.id, r.execucaoId)).limit(1)
  if (!ex || ex.estado === 'concluida' || ex.estado === 'cancelada') {
    console.log(`execução: ${ex?.estado} · ${ex?.motivoEncerramento}`)
    break
  }
  if (ex.estado === 'aguardando' && ex.retomarEm) {
    console.log(`  … espera até ${ex.retomarEm.toISOString()}`)
    relogio = ex.retomarEm
  }
}

console.log('')
const linhas = await d
  .select()
  .from(tentativa)
  .where(eq(tentativa.execucaoId, r.execucaoId))
  .orderBy(tentativa.criadoEm)

console.log('tentativas registradas:')
for (const t of linhas) {
  const conteudo = t.conteudo as { texto?: string }
  console.log(
    `  ${t.canal.padEnd(9)} ${t.estado.padEnd(10)} ${t.dryRun ? '[seco] ' : ''}${t.motivo ?? ''} ${
      conteudo.texto ? `"${conteudo.texto.slice(0, 60)}"` : ''
    }`,
  )
}

await encerrarFila()
process.exit(0)
