import { avaliarCondicao, type ContextoFluxo } from './condicao.ts'
import { duracaoEmMinutos } from './janela.ts'
import type { Canal, Etapa, Grafo, LimitesMotor, Posicao } from './tipos.ts'

/** Máquina de estados do fluxo.
 *
 *  Não faz I/O e não conhece fornecedor: recebe o grafo e o estado, devolve a
 *  próxima instrução. Quem executa é o worker. Essa separação é o que permite
 *  rodar o simulador com relógio virtual e o mesmo motor em produção. */

export interface EstadoMotor {
  posicao: Posicao
  contexto: ContextoFluxo
  tentativasFeitas: number
  /** Fluxos já visitados nesta corrente de subfluxos, para cortar laço. */
  cadeia: string[]
}

export type Instrucao =
  | { tipo: 'contatar'; etapa: Etapa; canal: Canal }
  | { tipo: 'esperar'; etapa: Etapa; minutos: number; cancelaSeResponder: boolean }
  | { tipo: 'acao'; etapa: Etapa }
  | { tipo: 'subfluxo'; etapa: Etapa }
  | { tipo: 'encerrar'; etapa?: Etapa; motivo: string }

const CANAIS: Partial<Record<string, Canal>> = {
  ligacao: 'ligacao',
  whatsapp: 'whatsapp',
  sms: 'sms',
  email: 'email',
}

/** Resolve a etapa apontada por uma posição, descendo por ramos e corpos. */
export function etapaEm(grafo: Grafo, posicao: Posicao): Etapa | undefined {
  let lista: Etapa[] = grafo
  let etapa: Etapa | undefined

  for (const quadro of posicao) {
    etapa = lista[quadro.indice]
    if (!etapa) return undefined
    if (quadro.ramo) {
      lista = etapa[quadro.ramo] ?? []
      etapa = undefined
    }
  }
  return etapa
}

function listaEm(grafo: Grafo, posicao: Posicao): Etapa[] {
  let lista: Etapa[] = grafo
  for (const quadro of posicao.slice(0, -1)) {
    const etapa = lista[quadro.indice]
    if (!etapa || !quadro.ramo) return lista
    lista = etapa[quadro.ramo] ?? []
  }
  return lista
}

/** Desce para um ramo (`sim`/`nao`) ou para o corpo de uma repetição. */
function descer(posicao: Posicao, ramo: 'sim' | 'nao' | 'corpo'): Posicao {
  const nova = posicao.map((q) => ({ ...q }))
  const ultimo = nova[nova.length - 1]
  if (ultimo) ultimo.ramo = ramo
  nova.push({ indice: 0 })
  return nova
}

/** Vai para a etapa seguinte no mesmo nível, subindo enquanto acabar a lista.
 *  Devolve `null` quando o fluxo inteiro terminou. */
function seguinte(grafo: Grafo, posicao: Posicao): Posicao | null {
  let pos: Posicao = posicao.map((q) => ({ ...q }))

  while (pos.length > 0) {
    const lista = listaEm(grafo, pos)
    const ultimo = pos[pos.length - 1]!
    const proximo = ultimo.indice + 1

    if (proximo < lista.length) {
      pos[pos.length - 1] = { indice: proximo }
      return pos
    }
    // Acabou este nível: volta para o pai, que fica apontando a etapa que abriu
    // o ramo, e segue dali.
    pos = pos.slice(0, -1)
    if (pos.length === 0) return null
    const pai = pos[pos.length - 1]!
    delete pai.ramo
  }
  return null
}

/** Repetição: decide entre dar mais uma volta no corpo ou sair. */
function decidirVolta(etapa: Etapa, pos: Posicao, ctx: ContextoFluxo): 'repetir' | 'sair' {
  const max = Number(etapa.cfg.max ?? '2')
  const quadro = pos[pos.length - 1]!
  // `volta` já foi incrementado por quem chamou; somar de novo tiraria uma volta.
  const volta = quadro.volta ?? 0

  const sair = etapa.cfg.sair ?? 'Nunca (só pelo limite)'
  if (sair === 'O lead responder' && ctx.respondeu) return 'sair'
  if (sair === 'O lead for qualificado' && ctx.qualificado) return 'sair'
  if (volta >= max) return 'sair'
  return 'repetir'
}

/** Caminha pelo grafo resolvendo o que não exige I/O — condição e repetição — até
 *  chegar numa instrução que o worker precisa executar.
 *
 *  O limite de passos protege contra grafo malformado: sem ele, uma repetição com
 *  corpo vazio giraria para sempre. */
export function proximaInstrucao(
  grafo: Grafo,
  estado: EstadoMotor,
  _limites: LimitesMotor,
): { instrucao: Instrucao; posicao: Posicao } {
  let pos = estado.posicao.length > 0 ? estado.posicao : [{ indice: 0 }]

  for (let passo = 0; passo < 1000; passo++) {
    const etapa = etapaEm(grafo, pos)
    if (!etapa) {
      const adiante = seguinte(grafo, pos)
      if (!adiante) {
        return { instrucao: { tipo: 'encerrar', motivo: 'fim do fluxo' }, posicao: pos }
      }
      pos = adiante
      continue
    }

    switch (etapa.tipo) {
      case 'condicao': {
        const ramo = avaliarCondicao(etapa.cfg, estado.contexto) ? 'sim' : 'nao'
        const filhos = etapa[ramo] ?? []
        if (filhos.length === 0) {
          const adiante = seguinte(grafo, pos)
          if (!adiante) {
            return { instrucao: { tipo: 'encerrar', motivo: 'fim do fluxo' }, posicao: pos }
          }
          pos = adiante
        } else {
          pos = descer(pos, ramo)
        }
        continue
      }

      case 'loop': {
        const corpo = etapa.corpo ?? []
        if (corpo.length === 0) {
          const adiante = seguinte(grafo, pos)
          if (!adiante) {
            return { instrucao: { tipo: 'encerrar', motivo: 'fim do fluxo' }, posicao: pos }
          }
          pos = adiante
          continue
        }
        pos = descer(pos, 'corpo')
        continue
      }

      case 'entrada':
      case 'guarda':
        // Não produzem contato: o motor aplica a guarda em toda tentativa, desenhada
        // ou não. Aqui só seguem adiante.
        {
          const adiante = seguinte(grafo, pos)
          if (!adiante) {
            return { instrucao: { tipo: 'encerrar', motivo: 'fim do fluxo' }, posicao: pos }
          }
          pos = adiante
        }
        continue

      case 'espera':
        return {
          instrucao: {
            tipo: 'esperar',
            etapa,
            minutos: duracaoEmMinutos(etapa.cfg.dur ?? '5 minutos'),
            cancelaSeResponder: etapa.cfg.cancel !== 'Não',
          },
          posicao: pos,
        }

      case 'ligacao':
      case 'whatsapp':
      case 'sms':
      case 'email':
        return { instrucao: { tipo: 'contatar', etapa, canal: CANAIS[etapa.tipo]! }, posicao: pos }

      case 'subfluxo':
        return { instrucao: { tipo: 'subfluxo', etapa }, posicao: pos }

      case 'encerrar':
        return {
          instrucao: { tipo: 'encerrar', etapa, motivo: etapa.cfg.motivo ?? 'encerrado' },
          posicao: pos,
        }

      default:
        // score, agendar, marcar, entregar, webhookout
        return { instrucao: { tipo: 'acao', etapa }, posicao: pos }
    }
  }
  return { instrucao: { tipo: 'encerrar', motivo: 'grafo malformado' }, posicao: pos }
}

/** Avança depois que o worker executou a instrução da posição atual.
 *  Devolve `null` quando não há mais nada a fazer. */
export function avancar(grafo: Grafo, posicao: Posicao, ctx: ContextoFluxo): Posicao | null {
  // Dentro do corpo de uma repetição, chegar ao fim do corpo não sai do bloco:
  // decide se dá mais uma volta.
  const lista = listaEm(grafo, posicao)
  const ultimo = posicao[posicao.length - 1]!
  const noFimDoCorpo = ultimo.indice + 1 >= lista.length && posicao.length > 1

  if (noFimDoCorpo) {
    const posPai = posicao.slice(0, -1)
    const quadroPai = posPai[posPai.length - 1]!
    if (quadroPai.ramo === 'corpo') {
      const etapaLoop = etapaEm(grafo, posPai.map((q, i) => (i === posPai.length - 1 ? { indice: q.indice } : q)))
      if (etapaLoop?.tipo === 'loop') {
        const marcado: Posicao = posPai.map((q) => ({ ...q }))
        const alvo = marcado[marcado.length - 1]!
        alvo.volta = (alvo.volta ?? 0) + 1

        if (decidirVolta(etapaLoop, marcado, ctx) === 'repetir') {
          const volta: Posicao = marcado.map((q) => ({ ...q }))
          volta.push({ indice: 0 })
          return volta
        }
        delete alvo.ramo
        return seguinte(grafo, marcado)
      }
    }
  }
  return seguinte(grafo, posicao)
}
