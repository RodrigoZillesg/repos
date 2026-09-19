import { and, eq } from 'drizzle-orm'
import { criarAdaptador } from '@avexa/adapters'
import {
  avancar,
  duracaoEmMinutos,
  podeChamarSubfluxo,
  podeContatar,
  proximaInstrucao,
  renderizar,
  somarDentroDaJanela,
  type Canal,
  type ContextoFluxo,
  type Etapa,
  type Grafo,
  type LimitesMotor,
  type Posicao,
} from '@avexa/core'
import {
  cliente as tCliente,
  execucao as tExecucao,
  fluxo as tFluxo,
  fluxoVersao as tVersao,
  lead as tLead,
  template as tTemplate,
  tentativa as tTentativa,
} from '@avexa/db'
import {
  agendarAvanco,
  carregarFatosContato,
  carregarLimites,
  oferecerReuniao,
} from '@avexa/servicos'
import { qualificar } from '@avexa/ia'
import type { Ambiente } from './contexto.ts'
import { entregarLead, dispararWebhookSaida } from './entrega.ts'

/** Dá o próximo passo de uma execução.
 *
 *  Um trabalho da fila pode consumir vários passos seguidos — condição, etiqueta,
 *  entrega — e só devolve o controle quando encontra algo que espera pelo mundo:
 *  uma espera, um adiamento ou o fim. O limite existe para que uma execução não
 *  monopolize o worker. */
const PASSOS_POR_TRABALHO = 20

export async function avancarExecucao(amb: Ambiente, execucaoId: string): Promise<void> {
  const { db } = amb

  const [ex] = await db.select().from(tExecucao).where(eq(tExecucao.id, execucaoId)).limit(1)
  if (!ex) return
  if (ex.estado === 'concluida' || ex.estado === 'cancelada' || ex.estado === 'falhou') return

  const [ld] = await db.select().from(tLead).where(eq(tLead.id, ex.leadId)).limit(1)
  const [cli] = await db.select().from(tCliente).where(eq(tCliente.id, ex.clienteId)).limit(1)
  const [ver] = await db.select().from(tVersao).where(eq(tVersao.id, ex.fluxoVersaoId)).limit(1)
  if (!ld || !cli || !ver) return

  const limites = await carregarLimites(db)
  const grafo = ver.grafo as Grafo
  const fuso = ld.fusoHorario ?? cli.fusoHorario
  const contexto = { ...(ex.contexto as ContextoFluxo) }

  let posicao = ex.posicao as Posicao
  let tentativasFeitas = ex.tentativasFeitas
  const seco = ex.dryRun

  for (let passo = 0; passo < PASSOS_POR_TRABALHO; passo++) {
    const agora = amb.agora()
    const r = proximaInstrucao(grafo, { posicao, contexto, tentativasFeitas, cadeia: ex.cadeia }, limites)
    posicao = r.posicao
    const inst = r.instrucao

    if (inst.tipo === 'encerrar') {
      await encerrar(amb, execucaoId, inst.motivo, contexto, tentativasFeitas)
      return
    }

    if (inst.tipo === 'esperar') {
      // Respondeu: a espera não vence, a sequência inteira é cancelada.
      if (inst.cancelaSeResponder && contexto.respondeu) {
        await encerrar(amb, execucaoId, 'lead respondeu', contexto, tentativasFeitas)
        return
      }
      const ate = somarDentroDaJanela(agora, inst.minutos, fuso, limites)
      // A posição é gravada JÁ avançada: acordar não pode reexecutar a espera.
      const depois = avancar(grafo, posicao, contexto)
      if (!depois) {
        await encerrar(amb, execucaoId, 'fim do fluxo', contexto, tentativasFeitas)
        return
      }
      await db
        .update(tExecucao)
        .set({
          estado: 'aguardando',
          posicao: depois,
          contexto,
          tentativasFeitas,
          retomarEm: ate,
        })
        .where(eq(tExecucao.id, execucaoId))
      await agendarAvanco(execucaoId, { em: ate })
      return
    }

    if (inst.tipo === 'contatar') {
      const resultado = await executarContato(amb, {
        execucaoId,
        etapa: inst.etapa,
        canal: inst.canal,
        limites,
        fuso,
        contexto,
        tentativasFeitas,
        seco,
        lead: ld,
        clienteId: cli.id,
        clienteNome: cli.nome,
        fluxoId: ex.fluxoId,
        agora,
      })

      if (resultado.acao === 'encerrar') {
        await encerrar(amb, execucaoId, resultado.motivo ?? 'bloqueado', contexto, tentativasFeitas)
        return
      }
      if (resultado.acao === 'adiar') {
        await db
          .update(tExecucao)
          .set({ estado: 'aguardando', posicao, contexto, tentativasFeitas, retomarEm: resultado.em! })
          .where(eq(tExecucao.id, execucaoId))
        await agendarAvanco(execucaoId, { em: resultado.em! })
        return
      }
      if (resultado.acao === 'enviou') tentativasFeitas++
      // 'pular' cai aqui também: a etapa foi descartada e o fluxo segue.
    } else if (inst.tipo === 'subfluxo') {
      const parar = await executarSubfluxo(amb, ex, inst.etapa, limites)
      if (parar) {
        await encerrar(amb, execucaoId, 'entregue ao subfluxo', contexto, tentativasFeitas)
        return
      }
    } else {
      await executarAcao(amb, {
        etapa: inst.etapa,
        contexto,
        lead: ld,
        clienteNome: cli.nome,
        clienteId: cli.id,
        execucaoId,
        seco,
        limites,
      })
    }

    const depois = avancar(grafo, posicao, contexto)
    if (!depois) {
      await encerrar(amb, execucaoId, 'fim do fluxo', contexto, tentativasFeitas)
      return
    }
    posicao = depois
  }

  // Estourou o orçamento de passos deste trabalho: grava e volta para a fila.
  await db
    .update(tExecucao)
    .set({ estado: 'executando', posicao, contexto, tentativasFeitas })
    .where(eq(tExecucao.id, execucaoId))
  await agendarAvanco(execucaoId)
}

async function encerrar(
  amb: Ambiente,
  execucaoId: string,
  motivo: string,
  contexto: ContextoFluxo,
  tentativasFeitas: number,
): Promise<void> {
  await amb.db
    .update(tExecucao)
    .set({
      estado: 'concluida',
      motivoEncerramento: motivo,
      encerradoEm: amb.agora(),
      contexto,
      tentativasFeitas,
      retomarEm: null,
    })
    .where(eq(tExecucao.id, execucaoId))
}

interface PedidoContato {
  execucaoId: string
  etapa: Etapa
  canal: Canal
  limites: LimitesMotor
  fuso: string
  contexto: ContextoFluxo
  tentativasFeitas: number
  seco: boolean
  lead: typeof tLead.$inferSelect
  clienteId: string
  clienteNome: string
  fluxoId: string
  agora: Date
}

type ResultadoContato =
  | { acao: 'enviou' }
  | { acao: 'pular' }
  | { acao: 'encerrar'; motivo?: string }
  | { acao: 'adiar'; em: Date }

async function executarContato(amb: Ambiente, p: PedidoContato): Promise<ResultadoContato> {
  const { db } = amb

  // Template é resolvido antes da decisão, porque "template não aprovado" é um
  // dos motivos de bloqueio que as regras conhecem.
  const modelo = await carregarTemplate(amb, p.clienteId, p.canal, p.etapa.cfg.template)
  const exigeTemplate =
    p.canal === 'whatsapp' ? p.etapa.cfg.modo !== 'Conversa livre (janela aberta)' : p.canal !== 'ligacao'

  const fatos = await carregarFatosContato(db, {
    clienteId: p.clienteId,
    execucaoId: p.execucaoId,
    pessoaId: p.lead.pessoaId,
    canal: p.canal,
    telefone: p.lead.telefone,
    email: p.lead.email,
    fusoDoLead: p.fuso,
    tentativasFeitas: p.tentativasFeitas,
    ...(exigeTemplate ? { templateAprovado: modelo?.status === 'aprovado' } : {}),
  })

  const decisao = podeContatar(fatos, p.limites, p.agora)

  if (!decisao.pode) {
    // Adiar não é tentar. Gravar uma linha a cada adiamento encheria a auditoria
    // de falsos cancelamentos — um lead fora da janela seria "cancelado" todo
    // dia até a janela abrir. A espera já está registrada na própria execução,
    // com `retomarEm`.
    if (decisao.acao === 'adiar') {
      return { acao: 'adiar', em: decisao.adiarPara ?? p.agora }
    }

    // Bloqueio definitivo, esse sim, vira registro: sem ele, "por que este lead
    // não foi contatado?" não teria resposta no painel.
    await db.insert(tTentativa).values({
      execucaoId: p.execucaoId,
      leadId: p.lead.id,
      clienteId: p.clienteId,
      fluxoId: p.fluxoId,
      pessoaId: p.lead.pessoaId,
      etapaId: p.etapa.id,
      canal: p.canal,
      destinatario: fatos.destinatario ?? '',
      estado: decisao.motivo === 'suprimido' ? 'suprimida' : 'cancelada',
      motivo: decisao.motivo,
      dryRun: p.seco,
      agendadaPara: p.agora,
    })

    if (decisao.acao === 'encerrar') return { acao: 'encerrar', motivo: decisao.motivo }
    return { acao: 'pular' }
  }

  // Ordem importa: as variáveis do template são valor PADRÃO, e o dado do lead
  // manda sobre elas. Invertido, um template com curso "inglês geral" apagaria o
  // "IELTS" que a pessoa escreveu no formulário.
  const valores = {
    ...(modelo?.variaveis ?? {}),
    ...(p.lead.campos as Record<string, unknown>),
    nome: p.lead.nome ?? '',
    cliente: p.clienteNome,
    // Disponível para o texto usar como {{link_agendamento}} quando o fluxo
    // passou por uma etapa de agenda que devolveu link.
    link_agendamento: (p.contexto.linkAgendamento as string | undefined) ?? '',
  }
  let corpo = modelo ? renderizar(modelo.corpo, valores) : { texto: '', faltando: [] }

  // "Incluir link de agendamento" no nó de SMS: acrescenta o link só quando ele
  // existe e o texto ainda não o traz, para não mandar o endereço duas vezes.
  const link = p.contexto.linkAgendamento as string | undefined
  if (p.etapa.cfg.link === 'Sim' && link && !corpo.texto.includes(link)) {
    corpo = { ...corpo, texto: `${corpo.texto} ${link}`.trim() }
  }
  const assunto = modelo?.assunto ? renderizar(modelo.assunto, valores).texto : undefined

  // Um texto que pede o link e sai sem ele chega ao lead como frase cortada
  // ("marque aqui:" e nada). Melhor não mandar e deixar o motivo visível no
  // monitor: o lead ainda vai ser entregue ao time, que agenda por fora.
  if (corpo.faltando.includes('link_agendamento')) {
    await db.insert(tTentativa).values({
      execucaoId: p.execucaoId,
      leadId: p.lead.id,
      clienteId: p.clienteId,
      fluxoId: p.fluxoId,
      pessoaId: p.lead.pessoaId,
      etapaId: p.etapa.id,
      canal: p.canal,
      destinatario: fatos.destinatario ?? '',
      estado: 'cancelada',
      motivo: 'sem_link_agendamento',
      ...(modelo ? { templateId: modelo.id } : {}),
      conteudo: { assunto: assunto ?? null, texto: corpo.texto, faltando: corpo.faltando },
      dryRun: p.seco,
      agendadaPara: p.agora,
    })
    return { acao: 'pular' }
  }

  const [nova] = await db
    .insert(tTentativa)
    .values({
      execucaoId: p.execucaoId,
      leadId: p.lead.id,
      clienteId: p.clienteId,
      fluxoId: p.fluxoId,
      pessoaId: p.lead.pessoaId,
      etapaId: p.etapa.id,
      canal: p.canal,
      destinatario: fatos.destinatario!,
      estado: 'agendada',
      ...(modelo ? { templateId: modelo.id } : {}),
      conteudo: { assunto: assunto ?? null, texto: corpo.texto, faltando: corpo.faltando },
      dryRun: p.seco,
      agendadaPara: p.agora,
    })
    .returning({ id: tTentativa.id })

  const adaptador = criarAdaptador(p.canal, amb.adaptadores, { seco: p.seco })
  if (!adaptador) {
    await db
      .update(tTentativa)
      .set({ estado: 'cancelada', motivo: 'canal_desligado', erro: 'adaptador não configurado' })
      .where(eq(tTentativa.id, nova!.id))
    return { acao: 'pular' }
  }

  const envio = await adaptador.enviar({
    tentativaId: nova!.id,
    canal: p.canal,
    destinatario: fatos.destinatario!,
    ...(assunto ? { assunto } : {}),
    texto: corpo.texto,
    ...(modelo?.metaTemplateId ? { templateExterno: modelo.metaTemplateId } : {}),
    variaveis: Object.fromEntries(
      Object.entries(modelo?.variaveis ?? {}).map(([k, v]) => [k, String(v)]),
    ),
    opcoes: opcoesDoCanal(p.etapa, p.canal),
  })

  await db
    .update(tTentativa)
    .set({
      estado: envio.ok ? 'enviada' : 'falhou',
      provedor: adaptador.provedor,
      ...(envio.provedorId ? { provedorId: envio.provedorId } : {}),
      ...(envio.erro ? { erro: envio.erro } : {}),
      resultado: (envio.detalhe ?? {}) as Record<string, unknown>,
      executadaEm: amb.agora(),
    })
    .where(eq(tTentativa.id, nova!.id))

  // Falha passageira não consome tentativa: volta para a fila e tenta de novo.
  if (!envio.ok && envio.reenviavel) {
    return { acao: 'adiar', em: new Date(amb.agora().getTime() + 5 * 60_000) }
  }
  return { acao: 'enviou' }
}

function opcoesDoCanal(etapa: Etapa, canal: Canal): Record<string, unknown> {
  if (canal === 'email') {
    return { replyTo: etapa.cfg.replyto === 'Time do cliente' ? undefined : undefined }
  }
  if (canal === 'ligacao') {
    return {
      roteiro: etapa.cfg.roteiro ?? '',
      tempoToqueSegundos: Number((etapa.cfg.ring ?? '30 segundos').split(' ')[0]),
      deixarRecado: etapa.cfg.vm === 'Deixar recado',
    }
  }
  return {}
}

async function carregarTemplate(amb: Ambiente, clienteId: string, canal: Canal, nome?: string) {
  if (!nome) return null
  const [t] = await amb.db
    .select()
    .from(tTemplate)
    .where(
      and(eq(tTemplate.clienteId, clienteId), eq(tTemplate.canal, canal), eq(tTemplate.nome, nome)),
    )
    .limit(1)
  return t ?? null
}

interface PedidoAcao {
  etapa: Etapa
  contexto: ContextoFluxo
  lead: typeof tLead.$inferSelect
  clienteNome: string
  clienteId: string
  execucaoId: string
  seco: boolean
  limites: LimitesMotor
}

async function executarAcao(amb: Ambiente, p: PedidoAcao): Promise<void> {
  switch (p.etapa.tipo) {
    case 'marcar': {
      const tag = p.etapa.cfg.tag
      if (tag) {
        p.contexto.etiquetas = [...(p.contexto.etiquetas ?? []), tag]
        await amb.db
          .update(tLead)
          .set({ etiquetas: [...(p.lead.etiquetas ?? []), tag] })
          .where(eq(tLead.id, p.lead.id))
      }
      return
    }

    case 'score': {
      const historico = await montarHistorico(amb, p.execucaoId)
      const q = await qualificar(amb.ia, {
        contexto: p.clienteNome,
        criterios: p.etapa.cfg.criterio ?? '',
        historico,
        campos: p.lead.campos as Record<string, unknown>,
      })
      const corte = Number(p.etapa.cfg.corte ?? '60')
      if (q.score !== null) p.contexto.score = q.score
      else delete p.contexto.score
      // Sem score confiável o lead não é descartado: fica não qualificado e o
      // motivo vai para o registro, para alguém olhar.
      p.contexto.qualificado = q.score !== null && q.score >= corte
      await amb.db
        .update(tLead)
        .set({ score: q.score, scoreMotivo: q.motivo, resumo: q.resumo })
        .where(eq(tLead.id, p.lead.id))
      return
    }

    case 'entregar':
      await entregarLead(amb, {
        leadId: p.lead.id,
        clienteId: p.clienteId,
        destino: p.etapa.cfg.destino ?? 'Webhook do cliente',
        urgente: p.etapa.cfg.urgente === 'Sim',
        seco: p.seco,
      })
      return

    case 'webhookout':
      await dispararWebhookSaida(amb, {
        leadId: p.lead.id,
        url: p.etapa.cfg.url ?? '',
        metodo: p.etapa.cfg.metodo ?? 'POST',
        payload: p.etapa.cfg.payload ?? 'Lead completo com UTMs',
        cabecalhos: p.etapa.cfg.headers ?? '',
        tentativas: p.etapa.cfg.retry === 'Tentar de novo 5 vezes' ? 5 : p.etapa.cfg.retry === 'Seguir sem reenviar' ? 1 : 3,
        seco: p.seco,
      })
      return

    case 'agendar': {
      // Sem e-mail não há como convidar nem identificar quem marcou pelo link.
      // O fluxo segue: o lead ainda será entregue ao time, que agenda por fora.
      if (!p.lead.email) {
        p.contexto.agendamento = { ok: false, motivo: 'lead sem e-mail' }
        return
      }

      const duracao = Number((p.etapa.cfg.dur ?? '30 minutos').split(' ')[0])
      const lembrete =
        p.etapa.cfg.lembrete === '1 hora' ? 60 : p.etapa.cfg.lembrete === '24 horas' ? 1440 : undefined

      const r = await oferecerReuniao(amb.db, {
        clienteId: p.clienteId,
        leadId: p.lead.id,
        execucaoId: p.execucaoId,
        titulo: `${p.clienteNome} · conversa com ${p.lead.nome ?? 'lead'}`,
        descricao: p.lead.resumo ?? '',
        duracaoMin: duracao,
        ...(lembrete !== undefined ? { lembreteMin: lembrete } : {}),
        emailDoLead: p.lead.email,
        ...(p.lead.nome ? { nomeDoLead: p.lead.nome } : {}),
        fusoDoLead: p.lead.fusoHorario ?? 'Australia/Sydney',
        limites: p.limites,
        de: amb.agora(),
        rodizio: p.etapa.cfg.agenda === 'Rodízio entre consultores',
      })

      if (r.tipo === 'marcado') {
        p.contexto.agendamento = {
          ok: true,
          modo: 'marcado',
          inicio: r.inicio.toISOString(),
          responsavel: r.responsavel,
          ...(r.conferencia ? { conferencia: r.conferencia } : {}),
        }
        p.contexto.qualificado = true
        await amb.db
          .update(tLead)
          .set({ etiquetas: [...(p.lead.etiquetas ?? []), 'reuniao-agendada'] })
          .where(eq(tLead.id, p.lead.id))
      } else if (r.tipo === 'link') {
        // Quem escolhe o horário é o lead. O link entra no contexto para que a
        // próxima etapa de canal o entregue — e a reunião só existe quando o
        // webhook do fornecedor avisar que ele marcou.
        p.contexto.linkAgendamento = r.url
        p.contexto.agendamento = { ok: true, modo: 'link', url: r.url }
        await amb.db
          .update(tLead)
          .set({ etiquetas: [...(p.lead.etiquetas ?? []), 'link-agendamento-enviado'] })
          .where(eq(tLead.id, p.lead.id))
      } else {
        // Não fingimos que agendou. O motivo fica no contexto e o fluxo segue
        // para a entrega, onde alguém do time resolve na mão.
        p.contexto.agendamento = { ok: false, motivo: r.erro }
      }
      return
    }

    default:
      return
  }
}

/** Junta o que aconteceu até aqui, para o nó de qualificação ler. */
async function montarHistorico(amb: Ambiente, execucaoId: string): Promise<string> {
  const linhas = await amb.db
    .select()
    .from(tTentativa)
    .where(eq(tTentativa.execucaoId, execucaoId))
    .orderBy(tTentativa.criadoEm)

  return linhas
    .map((t) => {
      const res = t.resultado as Record<string, unknown>
      const extra = res.transcricao ?? res.resposta ?? ''
      return `[${t.canal}] ${t.estado}${t.respondidaEm ? ' (respondeu)' : ''}${extra ? `: ${extra}` : ''}`
    })
    .join('\n')
}

async function executarSubfluxo(
  amb: Ambiente,
  ex: typeof tExecucao.$inferSelect,
  etapa: Etapa,
  limites: LimitesMotor,
): Promise<boolean> {
  const nome = etapa.cfg.alvo
  if (!nome) return false

  const [alvo] = await amb.db
    .select()
    .from(tFluxo)
    .where(and(eq(tFluxo.clienteId, ex.clienteId), eq(tFluxo.nome, nome)))
    .limit(1)
  if (!alvo?.versaoPublicadaId) return false

  const permissao = podeChamarSubfluxo(ex.cadeia, alvo.id, limites)
  if (!permissao.pode) {
    // A cadeia foi cortada. O fluxo que chamou continua; só a chamada não
    // acontece, para não criar laço infinito.
    return false
  }

  const [filha] = await amb.db
    .insert(tExecucao)
    .values({
      leadId: ex.leadId,
      clienteId: ex.clienteId,
      fluxoId: alvo.id,
      fluxoVersaoId: alvo.versaoPublicadaId,
      posicao: [{ indice: 0 }],
      contexto: ex.contexto,
      profundidade: ex.profundidade + 1,
      cadeia: [...ex.cadeia, alvo.id],
      execucaoPaiId: ex.id,
      dryRun: ex.dryRun,
    })
    .returning({ id: tExecucao.id })

  await agendarAvanco(filha!.id)
  return etapa.cfg.modo === 'Entregar o lead e encerrar aqui'
}

export { duracaoEmMinutos }
