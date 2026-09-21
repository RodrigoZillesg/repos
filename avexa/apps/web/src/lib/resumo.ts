/** A aritmética do resumo de leads, separada de quem consulta e de quem desenha.
 *
 *  Fica aqui porque `dados.ts` é `server-only` e arrasta o banco junto: o que é
 *  conta pura precisa poder ser testado sem subir Postgres. E é justamente a
 *  conta que erra calado — um "+300%" que na verdade é "de zero para três". */

export const PERIODOS = [7, 30, 90] as const
export type Periodo = (typeof PERIODOS)[number]

/** O período vem da URL, então vem de qualquer um. Valor fora da lista cai no
 *  padrão em vez de virar uma janela de 9999 dias que varre a base inteira. */
export const periodoValido = (v: unknown): Periodo =>
  PERIODOS.includes(Number(v) as Periodo) ? (Number(v) as Periodo) : 30

export interface NumeroDoResumo {
  valor: number
  /** O mesmo número no período imediatamente anterior, de igual duração.
   *  `null` quando não havia nada antes — aí não há comparação a fazer. */
  anterior: number | null
}

export type Variacao =
  | { tipo: 'nenhuma' }
  | { tipo: 'igual' }
  | { tipo: 'delta'; subiu: boolean; texto: string }

/** Como mostrar a diferença contra o período anterior.
 *
 *  Duas decisões que parecem detalhe e não são:
 *
 *  1. Sem período anterior, nada é mostrado. O primeiro mês de um cliente
 *     exibiria "+100%" em tudo — ruído com cara de resultado.
 *  2. Percentual só quando há base para dividir. De 0 para 3 não é "+300%": é
 *     "+3". Dividir por zero e arredondar produz um número que parece medido. */
export function variacao(n: NumeroDoResumo): Variacao {
  if (n.anterior === null) return { tipo: 'nenhuma' }

  const delta = n.valor - n.anterior
  if (delta === 0) return { tipo: 'igual' }

  const pct = n.anterior > 0 ? Math.round((delta / n.anterior) * 100) : null
  return {
    tipo: 'delta',
    subiu: delta > 0,
    // O sinal é escrito, não só colorido: cor sozinha não carrega informação
    // para quem não a distingue.
    texto: `${delta > 0 ? '+' : '−'}${pct !== null ? `${Math.abs(pct)}%` : Math.abs(delta)}`,
  }
}

/* ------------------------------- Paginação -------------------------------- */

/** Quantos leads por página. Cabe numa tela sem rolagem infinita e mantém as
 *  consultas por lead (tentativas, entregas, reuniões) num tamanho previsível —
 *  elas são feitas para os ids da página, não para a base inteira. */
export const POR_PAGINA = 50

/** A posição de um lead na ordem da lista.
 *
 *  `criadoEm` sozinho não serve de cursor: dois leads do mesmo formulário caem
 *  no mesmo milissegundo com frequência, e a fronteira entre páginas cortaria
 *  no meio do empate — um dos dois sumiria da listagem. O id desempata. */
export interface Cursor {
  criadoEm: Date
  id: string
}

/** Texto para a URL. O ISO já é ordenável e legível; o id vem depois do `_`,
 *  que não aparece nem no ISO nem num uuid. */
export const cursorParaTexto = (c: Cursor) => `${c.criadoEm.toISOString()}_${c.id}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lê o cursor da URL, que é escrita por qualquer um.
 *
 *  Devolve `null` para qualquer coisa que não seja exatamente uma data válida
 *  mais um uuid: um cursor inventado cairia na consulta como data inválida e
 *  derrubaria a página, em vez de simplesmente voltar ao começo da lista. */
export function textoParaCursor(v: unknown): Cursor | null {
  if (typeof v !== 'string') return null
  const corte = v.indexOf('_')
  if (corte < 1) return null

  const id = v.slice(corte + 1)
  if (!UUID.test(id)) return null

  const criadoEm = new Date(v.slice(0, corte))
  if (Number.isNaN(criadoEm.getTime())) return null

  return { criadoEm, id }
}

/** Quais setas a página oferece.
 *
 *  A assimetria entre ir e voltar é fácil de errar de cabeça, então mora aqui,
 *  fora da consulta, onde dá para prender com teste:
 *
 *  - indo para frente, "anterior" existe porque viemos de algum lugar, e
 *    "próxima" só se sobrou linha na consulta;
 *  - voltando, é o contrário: "próxima" existe sempre, porque a página de onde
 *    viemos está logo abaixo, e "anterior" só se sobrou linha.
 *
 *  Errar isso não quebra nada de forma visível: dá uma seta que leva a uma
 *  página vazia, ou uma seta que falta e esconde metade da lista. */
export interface Fronteiras {
  anterior: boolean
  proxima: boolean
}

export function fronteiras(p: {
  /** A consulta foi feita de trás para frente (clicou em "mais recentes"). */
  voltando: boolean
  /** Veio de uma página anterior, em vez de ser a primeira. */
  comCursor: boolean
  /** A consulta trouxe mais linhas do que cabem na página. */
  temMais: boolean
  /** Página vazia não oferece seta nenhuma: não há de onde tirar o cursor. */
  vazia: boolean
}): Fronteiras {
  if (p.vazia) return { anterior: false, proxima: false }
  return p.voltando
    ? { anterior: p.temMais, proxima: true }
    : { anterior: p.comCursor, proxima: p.temMais }
}
