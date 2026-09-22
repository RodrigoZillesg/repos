/** Tudo que a ativação deixou de pé num cliente, incluindo o que falhou.
 *
 *  A ativação devolve os avisos para a tela e eles morrem ali. Quando algo
 *  falha — a Vapi recusa o agente, o Twilio recusa a compra — a única evidência
 *  que sobra é o estado no banco, e ele não conta o porquê.
 *
 *  Este script conta: mostra o que existe, e para o agente de voz TENTA
 *  publicar de novo imprimindo a resposta do fornecedor por inteiro. É a
 *  diferença entre "falhou na Vapi" e saber qual campo ela recusou.
 *
 *  Só lê o nosso banco. A única escrita possível é a publicação do agente na
 *  Vapi, e ela só acontece com `--publicar`: sem a opção, o corpo que seria
 *  mandado é impresso e nada sai.
 *
 *      pnpm --filter @avexa/worker diagnostico <slug>
 *      pnpm --filter @avexa/worker diagnostico <slug> --publicar
 */
import { eq } from 'drizzle-orm'
import { agenteVoz, cliente, db, fluxo, integracao, numero, projeto, projetoCanal, template } from '@avexa/db'
import {
  credenciaisVapiDoAmbiente,
  publicarAgente,
  segredoDoWebhookDeVoz,
  webhookDeLigacao,
} from '@avexa/servicos'

const d = db()
const slug = process.argv[2]?.trim()
const publicar = process.argv.includes('--publicar')

if (!slug) {
  console.error('uso: diagnostico <slug-do-cliente> [--publicar]')
  process.exit(1)
}

const [c] = await d.select().from(cliente).where(eq(cliente.slug, slug)).limit(1)
if (!c) {
  console.error(`nenhum cliente com o slug "${slug}"`)
  process.exit(1)
}

console.log(`== ${c.nome} (${c.slug}) ==`)
console.log(`   ${c.fusoHorario} · ${c.pais} · status ${c.status} · criado ${c.criadoEm.toISOString()}`)

const projetos = await d.select().from(projeto).where(eq(projeto.clienteId, c.id))
console.log(`\n-- projetos (${projetos.length}) --`)

for (const p of projetos) {
  console.log(`\n   ${p.nome} (${p.slug}) · seco=${p.dryRun} · ativo=${p.ativo}`)

  const canais = await d.select().from(projetoCanal).where(eq(projetoCanal.projetoId, p.id))
  for (const ch of canais) {
    console.log(`     canal ${ch.canal.padEnd(9)} ativo=${String(ch.ativo).padEnd(5)} config=${JSON.stringify(ch.config)}`)
  }

  const nums = await d.select().from(numero).where(eq(numero.projetoId, p.id))
  for (const n of nums) {
    console.log(
      `     número ${n.e164} · ${n.status} · capacidades=${JSON.stringify(n.capacidades)} · ` +
        `SID=${n.provedorSid ?? 'NENHUM (não veio de compra nossa)'} · assistenteId=${n.assistenteId ?? '—'}`,
    )
  }
  if (nums.length === 0) console.log('     número: nenhum atribuído')

  const fls = await d.select().from(fluxo).where(eq(fluxo.projetoId, p.id))
  for (const f of fls) {
    console.log(`     fluxo ${f.slug.padEnd(28)} ${f.status} · publicada=${f.versaoPublicadaId ? 'sim' : 'NÃO'}`)
  }

  const tpls = await d.select().from(template).where(eq(template.projetoId, p.id))
  console.log(`     templates: ${tpls.length}`)

  const ints = await d.select().from(integracao).where(eq(integracao.projetoId, p.id))
  console.log(`     destinos: ${ints.map((x) => `${x.tipo}${x.ativo ? '' : ' (inativo)'}`).join(', ') || 'nenhum'}`)

  // O agente de voz, que é onde a Vapi entra.
  const [ag] = await d.select().from(agenteVoz).where(eq(agenteVoz.projetoId, p.id)).limit(1)
  if (!ag) {
    console.log('     agente de voz: NENHUM')
    continue
  }

  console.log(
    `     agente "${ag.nome}" · modelo ${ag.modeloProvedor}/${ag.modelo} · voz ${ag.provedorVoz}/${ag.vozId} · ` +
      `transcritor ${ag.transcritor}${ag.modeloTranscritor ? `/${ag.modeloTranscritor}` : ''}`,
  )
  console.log(`     vapiAssistantId: ${ag.vapiAssistantId ?? 'NENHUM — nunca foi publicado'}`)
  console.log(`     publicadoEm: ${ag.publicadoEm?.toISOString() ?? '—'}`)

  const vapi = credenciaisVapiDoAmbiente()
  if (!vapi) {
    console.log('     Vapi não configurada neste ambiente: nada a tentar.')
    continue
  }

  if (!publicar) {
    console.log('\n     (para ver a resposta da Vapi, rode de novo com --publicar)')
    continue
  }

  console.log('\n     publicando na Vapi para ver a resposta…')
  const r = await publicarAgente(d, ag.id, vapi, webhookDeLigacao(), segredoDoWebhookDeVoz())
  console.log(r.ok ? `     OK · assistente ${r.vapiAssistantId}` : `     FALHOU · ${r.erro}`)
}

process.exit(0)
