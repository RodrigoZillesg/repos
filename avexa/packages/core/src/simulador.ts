import type { ContextoFluxo } from './condicao.ts'
import { ETAPAS } from './etapas.ts'
import { somarDentroDaJanela, proximaJanela } from './janela.ts'
import { avancar, proximaInstrucao, type EstadoMotor } from './motor.ts'
import { podeContatar, type FatosContato } from './regras.ts'
import { LIMITES_PADRAO, type Canal, type Grafo, type LimitesMotor } from './tipos.ts'

/** Simulação de um fluxo contra um lead fictício.
 *
 *  Roda o motor de verdade com relógio virtual e sem adaptador nenhum, então serve
 *  às duas coisas ao mesmo tempo: a tela que confere um fluxo antes de publicar, e
 *  o teste que roda em CI a cada alteração de fluxo ou de regra. */

export type Persona = 'quente' | 'morno' | 'email' | 'frio' | 'optout'

export const PERSONAS: Record<Persona, string> = {
  quente: 'Responde na primeira tentativa',
  morno: 'Só responde na segunda tentativa',
  email: 'Ignora telefone, responde e-mail',
  frio: 'Nunca responde',
  optout: 'Pede para parar',
}

export type TipoEvento = 'contato' | 'espera' | 'bloqueio' | 'acao' | 'resposta' | 'encerramento'

export interface EventoSimulado {
  instante: Date
  tipo: TipoEvento
  etapaId: string
  rotulo: string
  canal?: Canal
  detalhe?: string
  /** Para uma espera: quando ela vence. Fica como Date, não como texto, para que
   *  a tela possa mostrar no relógio do lead — que é o único relógio que importa
   *  aqui, e o que torna "24 horas" virar sexta-feira em vez de quinta. */
  ate?: Date
}

export interface ResultadoSimulacao {
  eventos: EventoSimulado[]
  contatos: number
  respondeu: boolean
  suprimido: boolean
  motivoFinal: string
}

export interface OpcoesSimulacao {
  inicio?: Date
  fuso?: string
  limites?: LimitesMotor
  /** Canais contratados pelo cliente. Um canal de fora fica bloqueado, como em produção. */
  canaisAtivos?: readonly Canal[]
}

/** Como cada persona reage a um contato. Devolve o que aconteceu naquele contato. */
function reagir(persona: Persona, canal: Canal, numeroDoContato: number): 'responde' | 'optout' | 'nada' {
  switch (persona) {
    case 'quente':
      return numeroDoContato >= 1 ? 'responde' : 'nada'
    case 'morno':
      return numeroDoContato >= 2 ? 'responde' : 'nada'
    case 'email':
      return canal === 'email' ? 'responde' : 'nada'
    case 'optout':
      return 'optout'
    case 'frio':
      return 'nada'
  }
}

export function simular(
  grafo: Grafo,
  persona: Persona,
  opcoes: OpcoesSimulacao = {},
): ResultadoSimulacao {
  const limites = opcoes.limites ?? LIMITES_PADRAO
  const fuso = opcoes.fuso ?? 'America/Sao_Paulo'
  const canaisAtivos = opcoes.canaisAtivos ?? (['ligacao', 'whatsapp', 'sms', 'email'] as const)

  let agora = proximaJanela(opcoes.inicio ?? new Date('2026-03-10T13:00:00Z'), fuso, limites)

  const contexto: ContextoFluxo = { tentativasFeitas: 0, respondeu: false, etiquetas: [] }
  const estado: EstadoMotor = { posicao: [{ indice: 0 }], contexto, tentativasFeitas: 0, cadeia: [] }

  const eventos: EventoSimulado[] = []
  let contatos = 0
  let suprimido = false
  let motivoFinal = 'fim do fluxo'

  const registrar = (e: Omit<EventoSimulado, 'instante'>) =>
    eventos.push({ instante: new Date(agora), ...e })

  // O teto de passos é folgado: só existe para que um grafo malformado falhe o
  // teste em vez de travar o processo.
  for (let passo = 0; passo < 500; passo++) {
    const { instrucao, posicao } = proximaInstrucao(grafo, { ...estado, posicao: estado.posicao }, limites)
    estado.posicao = posicao

    if (instrucao.tipo === 'encerrar') {
      motivoFinal = instrucao.motivo
      registrar({
        tipo: 'encerramento',
        etapaId: instrucao.etapa?.id ?? '—',
        rotulo: 'Encerrar',
        detalhe: instrucao.motivo,
      })
      break
    }

    if (instrucao.tipo === 'esperar') {
      // Responder cancela a espera, e com ela o resto da sequência.
      if (instrucao.cancelaSeResponder && contexto.respondeu) {
        motivoFinal = 'lead respondeu'
        registrar({ tipo: 'encerramento', etapaId: instrucao.etapa.id, rotulo: 'Sequência cancelada' })
        break
      }
      const ate = somarDentroDaJanela(agora, instrucao.minutos, fuso, limites)
      registrar({
        tipo: 'espera',
        etapaId: instrucao.etapa.id,
        rotulo: 'Esperar',
        detalhe: instrucao.etapa.cfg.dur ?? '',
        ate,
      })
      agora = ate
    } else if (instrucao.tipo === 'contatar') {
      const fatos: FatosContato = {
        canal: instrucao.canal,
        destinatario: instrucao.canal === 'email' ? 'lead@exemplo.com' : '+5511999999999',
        suprimido,
        jaRespondeu: contexto.respondeu ?? false,
        canalAtivo: canaisAtivos.includes(instrucao.canal),
        tentativasFeitas: estado.tentativasFeitas,
        ultimoContatoEm: null,
        fusoDoLead: fuso,
      }
      const decisao = podeContatar(fatos, limites, agora)

      if (!decisao.pode) {
        registrar({
          tipo: 'bloqueio',
          etapaId: instrucao.etapa.id,
          rotulo: ETAPAS[instrucao.etapa.tipo].nome,
          canal: instrucao.canal,
          detalhe: decisao.motivo,
        })
        if (decisao.acao === 'encerrar') {
          motivoFinal = decisao.motivo
          break
        }
        if (decisao.acao === 'adiar') {
          agora = decisao.adiarPara ?? agora
          continue
        }
        // 'pular': a etapa é descartada e o fluxo segue para a próxima.
      } else {
        contatos++
        estado.tentativasFeitas++
        contexto.tentativasFeitas = estado.tentativasFeitas
        registrar({
          tipo: 'contato',
          etapaId: instrucao.etapa.id,
          rotulo: ETAPAS[instrucao.etapa.tipo].nome,
          canal: instrucao.canal,
        })

        const reacao = reagir(persona, instrucao.canal, contatos)
        if (reacao === 'responde') {
          contexto.respondeu = true
          registrar({
            tipo: 'resposta',
            etapaId: instrucao.etapa.id,
            rotulo: 'Lead respondeu',
            canal: instrucao.canal,
          })
        } else if (reacao === 'optout') {
          suprimido = true
          contexto.respondeu = true
          registrar({
            tipo: 'resposta',
            etapaId: instrucao.etapa.id,
            rotulo: 'Pediu para parar',
            canal: instrucao.canal,
            detalhe: 'entra na supressão global',
          })
        }
      }
    } else {
      // Ação sem contato: score, agendar, marcar, entregar, webhook de saída.
      const def = ETAPAS[instrucao.etapa.tipo]
      if (instrucao.etapa.tipo === 'score') {
        contexto.score = contexto.respondeu ? 80 : 20
        contexto.qualificado = (contexto.score ?? 0) >= Number(instrucao.etapa.cfg.corte ?? '60')
      }
      if (instrucao.etapa.tipo === 'marcar' && instrucao.etapa.cfg.tag) {
        contexto.etiquetas = [...(contexto.etiquetas ?? []), instrucao.etapa.cfg.tag]
      }
      registrar({
        tipo: 'acao',
        etapaId: instrucao.etapa.id,
        rotulo: def.nome,
        detalhe: def.resumo(instrucao.etapa.cfg),
      })
    }

    const adiante = avancar(grafo, estado.posicao, contexto)
    if (!adiante) {
      registrar({ tipo: 'encerramento', etapaId: '—', rotulo: 'Fim do fluxo' })
      break
    }
    estado.posicao = adiante
  }

  return { eventos, contatos, respondeu: contexto.respondeu ?? false, suprimido, motivoFinal }
}
