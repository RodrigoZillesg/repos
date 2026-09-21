import { ETAPAS } from './etapas.ts'
import type { Etapa, Grafo } from './tipos.ts'

/** Achata a árvore de etapas no grafo que ela descreve.
 *
 *  A estrutura de dados é uma árvore, mas o fluxo que ela executa **não é**.
 *  Duas coisas no motor provam isso:
 *
 *  - `seguinte()` sobe para o pai, apaga `pai.ramo` e continua do irmão
 *    seguinte — ou seja, `sim` e `não` **reconvergem** na etapa depois da
 *    condição. Isso é uma junção, não uma bifurcação que nunca mais se encontra.
 *  - `decidirVolta()` pode mandar a execução de volta ao início do corpo de uma
 *    repetição — uma **aresta de volta**, ou seja, um ciclo governado.
 *
 *  Junção e ciclo sempre existiram na semântica e nunca foram desenhados. É o
 *  que este módulo expõe: o desenho que o motor já executa.
 *
 *  Puro de propósito, sem React e sem nada de tela — o que permite prender o
 *  comportamento com teste, do mesmo jeito que o simulador. Quem desenha
 *  consome `{ nos, arestas }` e nunca olha para a árvore. */

export interface NoDoGrafo {
  id: string
  etapa: Etapa
  /** Profundidade de aninhamento: 0 no tronco, 1 dentro de um ramo, e assim
   *  por diante. Serve para o desenho agrupar, não para o motor. */
  nivel: number
  /** Id da etapa que abriu o ramo onde este nó vive, se houver. É o que permite
   *  desenhar o corpo de uma repetição como uma caixa envolvente. */
  dentroDe: string | null
  ramo: Ramo | null
}

export type Ramo = 'sim' | 'nao' | 'corpo'

export type TipoAresta =
  /** Sequência simples entre vizinhos. */
  | 'seguinte'
  /** Da condição para o primeiro nó de um ramo. */
  | 'ramo'
  /** Do fim de um ramo de volta ao tronco: a junção que `seguinte()` faz. */
  | 'juncao'
  /** Do fim do corpo de volta à repetição. É o ciclo governado. */
  | 'volta'

export interface ArestaDoGrafo {
  id: string
  de: string
  para: string
  tipo: TipoAresta
  /** "sim", "não", "repete" — o que fica escrito em cima da aresta. */
  rotulo?: string
}

export interface GrafoDesenhado {
  nos: NoDoGrafo[]
  arestas: ArestaDoGrafo[]
}

const ROTULO: Record<Ramo, string> = { sim: 'sim', nao: 'não', corpo: 'repete' }

/** Uma etapa encerra o fluxo: nada sai dela.
 *
 *  Desenhar uma aresta saindo de um `encerrar` seria desenhar um caminho que o
 *  motor nunca percorre — `proximaInstrucao` para ali. */
const encerra = (e: Etapa) => e.tipo === 'encerrar'

export function aplanar(grafo: Grafo): GrafoDesenhado {
  const nos: NoDoGrafo[] = []
  const arestas: ArestaDoGrafo[] = []
  let sequencia = 0
  const ligar = (de: string, para: string, tipo: TipoAresta, rotulo?: string) =>
    arestas.push({ id: `a${sequencia++}`, de, para, tipo, ...(rotulo ? { rotulo } : {}) })

  /** Percorre uma lista e devolve as pontas dela: por onde a execução sai.
   *
   *  Devolve uma lista, não um id: os dois ramos de uma condição saem pelas
   *  próprias pontas, e as duas precisam ser ligadas ao que vem depois. Uma
   *  lista vazia significa que tudo ali dentro encerra — e aí nada é ligado
   *  adiante, que é exatamente o que o motor faz. */
  function percorrer(
    lista: Etapa[],
    nivel: number,
    dentroDe: string | null,
    ramo: Ramo | null,
  ): string[] {
    // De onde sai a execução para chegar na próxima etapa desta lista.
    let pontas: string[] = []
    let entrada: string | null = null

    for (const e of lista) {
      nos.push({ id: e.id, etapa: e, nivel, dentroDe, ramo })
      if (entrada === null) entrada = e.id

      // Liga quem veio antes a esta etapa. Pode ser mais de um: as duas pontas
      // de uma condição reconvergem aqui.
      for (const p of pontas) {
        ligar(p, e.id, pontas.length > 1 ? 'juncao' : 'seguinte')
      }

      const def = ETAPAS[e.tipo]
      const proximas: string[] = []

      if (def.ramos) {
        // Ramo vazio não é um beco: o motor cai no irmão seguinte. Então a
        // condição vira ela mesma uma ponta, e a aresta sai dela com o rótulo
        // do ramo — senão o desenho mostraria um caminho a menos do que existe.
        for (const r of ['sim', 'nao'] as const) {
          const filhos = e[r]
          if (filhos && filhos.length > 0) {
            const dentro = percorrer(filhos, nivel + 1, e.id, r)
            ligar(e.id, filhos[0]!.id, 'ramo', ROTULO[r])
            proximas.push(...dentro)
          } else {
            proximas.push(e.id)
          }
        }
      } else if (def.corpo) {
        const filhos = e.corpo
        if (filhos && filhos.length > 0) {
          const dentro = percorrer(filhos, nivel + 1, e.id, 'corpo')
          ligar(e.id, filhos[0]!.id, 'ramo', ROTULO.corpo)
          // O ciclo governado: o fim do corpo volta para a repetição, que
          // decide entre dar outra volta ou seguir.
          for (const d of dentro) ligar(d, e.id, 'volta')
        }
        // A repetição também é a porta de saída: quando `decidirVolta` diz para
        // sair, a execução segue dela para a etapa seguinte.
        proximas.push(e.id)
      } else if (!encerra(e)) {
        proximas.push(e.id)
      }

      pontas = proximas
    }

    return pontas
  }

  percorrer(grafo, 0, null, null)
  return { nos, arestas }
}

/** O nó por onde a execução entra. É de onde o desenho começa. */
export const entradaDoGrafo = (g: Grafo): string | null => g[0]?.id ?? null
