import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { adaptadorResend, entregarWebhook, lerCabecalhos } from '@avexa/adapters'
import { integracao as tIntegracao, lead as tLead } from '@avexa/db'
import {
  cargaDoLead,
  entregarNoHubspot,
  registrarEntrega,
  registrarNaPlanilha,
  webhookDoCliente,
  type CargaLead,
  type DestinoEntrega,
  type RegistroEntrega,
} from '@avexa/servicos'
import type { Ambiente } from './contexto.ts'

/** Entrega do lead qualificado onde o cliente trabalha.
 *
 *  Os quatro destinos do construtor, mais o webhook de saída no meio do fluxo.
 *  Em modo seco nada sai — mas o registro sai, com estado `seco`: é assim que o
 *  lead de teste da ativação mostra que o destino está resolvido antes de
 *  qualquer lead real depender dele. */

export interface PedidoEntrega {
  leadId: string
  clienteId: string
  execucaoId?: string
  etapaId?: string
  destino: string
  urgente: boolean
  seco: boolean
}

/** Destinos que o nó "Entregar ao time" oferece. O webhook de saída do meio do
 *  fluxo não entra aqui: ele não depende de integração cadastrada. */
type DestinoDoNo = Exclude<DestinoEntrega, 'webhook_saida'>

const DESTINO: Record<string, DestinoDoNo> = {
  'CRM do cliente': 'hubspot',
  'E-mail do time': 'email_time',
  'Planilha compartilhada': 'google_sheets',
  'Webhook do cliente': 'webhook',
}

export interface ResultadoEntrega {
  ok: boolean
  destino?: DestinoEntrega
  externoId?: string
  erro?: string
  aviso?: string
}

export async function entregarLead(amb: Ambiente, p: PedidoEntrega): Promise<ResultadoEntrega> {
  const [ld] = await amb.db.select().from(tLead).where(eq(tLead.id, p.leadId)).limit(1)
  if (!ld) return { ok: false, erro: 'lead não encontrado' }

  const destino = DESTINO[p.destino]
  const base = {
    leadId: p.leadId,
    clienteId: p.clienteId,
    execucaoId: p.execucaoId,
    etapaId: p.etapaId,
    urgente: p.urgente,
  }

  if (!destino) {
    await registrarEntrega(amb.db, {
      ...base,
      destino: 'webhook',
      estado: 'sem_destino',
      erro: `destino desconhecido: ${p.destino}`,
    })
    return { ok: false, erro: `destino desconhecido: ${p.destino}` }
  }

  const carga = await cargaDoLead(amb.db, ld, p.urgente)

  if (p.seco) {
    await registrarEntrega(amb.db, { ...base, destino, estado: 'seco', dryRun: true })
    return { ok: true, destino }
  }

  const registrar = (r: Partial<RegistroEntrega> & { estado: RegistroEntrega['estado'] }) =>
    registrarEntrega(amb.db, { ...base, destino, ...r })

  const [conf] = await amb.db
    .select()
    .from(tIntegracao)
    .where(
      and(
        eq(tIntegracao.clienteId, p.clienteId),
        eq(tIntegracao.tipo, destino),
        eq(tIntegracao.ativo, true),
      ),
    )
    .limit(1)

  if (!conf) {
    const erro = `o fluxo pede "${p.destino}" e este cliente não tem esse destino configurado`
    await registrar({ estado: 'sem_destino', erro })
    return { ok: false, destino, erro }
  }

  const cfg = (conf.config ?? {}) as Record<string, string>

  if (destino === 'webhook') {
    const alvo = await webhookDoCliente(amb.db, p.clienteId)
    if (!alvo) {
      const erro = 'webhook do cliente sem URL'
      await registrar({ estado: 'sem_destino', erro })
      return { ok: false, destino, erro }
    }

    const entregaId = randomUUID()
    const r = await entregarWebhook({
      url: alvo.url,
      corpo: { tipo: 'lead.entregue', entregaId, dados: carga },
      segredo: alvo.segredo ?? undefined,
      entregaId,
      tentativas: 3,
    })
    await registrar({
      estado: r.ok ? 'entregue' : 'falhou',
      tentativas: r.tentativas,
      url: alvo.url,
      httpStatus: r.status,
      erro: r.erro,
      externoId: entregaId,
    })
    return r.ok
      ? { ok: true, destino, externoId: entregaId }
      : { ok: false, destino, ...(r.erro ? { erro: r.erro } : {}) }
  }

  if (destino === 'email_time') {
    if (!cfg.para) {
      await registrar({ estado: 'sem_destino', erro: 'sem endereço do time' })
      return { ok: false, destino, erro: 'sem endereço do time' }
    }
    if (!amb.adaptadores.email) {
      await registrar({ estado: 'falhou', erro: 'e-mail não configurado neste ambiente' })
      return { ok: false, destino, erro: 'e-mail não configurado neste ambiente' }
    }

    const resend = adaptadorResend(amb.adaptadores.email)
    const envio = await resend.enviar({
      tentativaId: `entrega-${ld.id}`,
      canal: 'email',
      destinatario: cfg.para,
      assunto: `${p.urgente ? '[URGENTE] ' : ''}Lead qualificado: ${ld.nome ?? ld.email ?? ld.telefone}`,
      texto: textoDoEmail(carga),
    })
    await registrar({
      estado: envio.ok ? 'entregue' : 'falhou',
      ...(envio.ok ? { externoId: envio.provedorId } : { erro: envio.erro }),
    })
    return envio.ok
      ? { ok: true, destino, ...(envio.provedorId ? { externoId: envio.provedorId } : {}) }
      : { ok: false, destino, ...(envio.erro ? { erro: envio.erro } : {}) }
  }

  if (destino === 'hubspot') {
    const r = await entregarNoHubspot(amb.db, p.clienteId, ld, carga)
    await registrar({
      estado: r.ok ? 'entregue' : 'falhou',
      externoId: r.externoId,
      erro: r.erro ?? r.aviso,
    })
    return r.ok
      ? { ok: true, destino, ...(r.externoId ? { externoId: r.externoId } : {}), ...(r.aviso ? { aviso: r.aviso } : {}) }
      : { ok: false, destino, ...(r.erro ? { erro: r.erro } : {}) }
  }

  const utm = carga.utm
  const r = await registrarNaPlanilha(amb.db, p.clienteId, [
    carga.criadoEm,
    ld.nome,
    ld.telefone,
    ld.email,
    ld.score,
    ld.scoreMotivo,
    ld.resumo,
    (ld.etiquetas ?? []).join(', '),
    utm.utm_source ?? null,
    utm.utm_campaign ?? null,
  ])
  await registrar({ estado: r.ok ? 'entregue' : 'falhou', ...(r.ok ? {} : { erro: r.erro }) })
  return r.ok ? { ok: true, destino } : { ok: false, destino, ...(r.erro ? { erro: r.erro } : {}) }
}

function textoDoEmail(c: CargaLead): string {
  const linhas = [
    `Score: ${c.score ?? '—'} (${c.motivo ?? 'sem motivo registrado'})`,
    `Resumo: ${c.resumo ?? '—'}`,
    `Telefone: ${c.telefone ?? '—'}`,
    `E-mail: ${c.email ?? '—'}`,
  ]
  if (c.etiquetas.length > 0) linhas.push(`Etiquetas: ${c.etiquetas.join(', ')}`)
  if (c.reuniao?.inicio) linhas.push(`Reunião marcada para ${c.reuniao.inicio}`)
  else if (c.reuniao?.link) linhas.push(`Link de agenda entregue ao lead: ${c.reuniao.link}`)
  if (c.utm.utm_source) linhas.push(`Origem: ${c.utm.utm_source} / ${c.utm.utm_campaign ?? '—'}`)
  return linhas.join('\n')
}

export interface PedidoWebhookSaida {
  leadId: string
  clienteId: string
  execucaoId?: string
  etapaId?: string
  url: string
  metodo: string
  payload: string
  cabecalhos: string
  tentativas: number
  seco: boolean
}

/** Webhook de saída no meio do fluxo.
 *
 *  O reenvio é imediato e curto, não a fila: este passo bloqueia o fluxo, e
 *  jogá-lo para a fila exigiria dividir a execução em duas. Falha definitiva não
 *  derruba o fluxo — o lead continua o percurso, e o registro diz o que houve.
 *
 *  Vai assinado com o mesmo segredo do webhook de entrega, quando o cliente tem
 *  um: quem recebe dado de lead precisa poder provar que veio de nós. */
export async function dispararWebhookSaida(
  amb: Ambiente,
  p: PedidoWebhookSaida,
): Promise<ResultadoEntrega> {
  if (!p.url) return { ok: false, erro: 'nó de webhook sem URL' }

  const [ld] = await amb.db.select().from(tLead).where(eq(tLead.id, p.leadId)).limit(1)
  if (!ld) return { ok: false, erro: 'lead não encontrado' }

  const base = {
    leadId: p.leadId,
    clienteId: p.clienteId,
    execucaoId: p.execucaoId,
    etapaId: p.etapaId,
    destino: 'webhook_saida' as const,
    url: p.url,
  }

  if (p.seco) {
    await registrarEntrega(amb.db, { ...base, estado: 'seco', dryRun: true })
    return { ok: true, destino: 'webhook_saida' }
  }

  const carga = await cargaDoLead(amb.db, ld)
  const corpo =
    p.payload === 'Lead e score'
      ? { id: carga.id, nome: carga.nome, telefone: carga.telefone, email: carga.email, score: carga.score }
      : p.payload === 'Só o resultado do contato'
        ? { id: carga.id, score: carga.score, resumo: carga.resumo, etiquetas: carga.etiquetas }
        : carga

  const alvo = await webhookDoCliente(amb.db, p.clienteId)
  const entregaId = randomUUID()
  const r = await entregarWebhook({
    url: p.url,
    metodo: p.metodo,
    corpo: { tipo: 'lead.webhook', entregaId, dados: corpo },
    cabecalhos: lerCabecalhos(p.cabecalhos),
    segredo: alvo?.segredo ?? undefined,
    entregaId,
    tentativas: Math.max(1, p.tentativas),
  })

  await registrarEntrega(amb.db, {
    ...base,
    estado: r.ok ? 'entregue' : 'falhou',
    tentativas: r.tentativas,
    httpStatus: r.status,
    erro: r.erro,
    externoId: entregaId,
  })

  return r.ok
    ? { ok: true, destino: 'webhook_saida', externoId: entregaId }
    : { ok: false, destino: 'webhook_saida', ...(r.erro ? { erro: r.erro } : {}) }
}
