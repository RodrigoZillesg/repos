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
