import dagre from '@dagrejs/dagre'
import type { ArestaDoGrafo, GrafoDesenhado } from '@avexa/core'

/** Onde cada nó fica na tela.
 *
 *  Calculado, nunca guardado. Essa é a decisão central do canvas e ela evita
 *  três problemas de uma vez:
 *
 *  1. arrastar um nó não marca o fluxo como alterado — e portanto não abre
 *     caminho para alguém publicar um fluxo não revisado só para limpar o aviso
 *     de "alterações não salvas";
 *  2. `fluxo_versao` é imutável e nunca é apagado: coordenada lá dentro criaria
 *     versões novas que não mudam nada, e poluiria para sempre qualquer
 *     comparação entre versões;
 *  3. some a classe inteira de bugs de ida-e-volta, em que salvar e recarregar
 *     embaralha o fluxo porque a árvore foi reconstruída a partir das posições.
 *
 *  O efeito colateral é bom: o desenho nunca fica bagunçado, que é justamente o
 *  defeito nº 1 dos editores de canvas livre. */

export const LARGURA_NO = 240
export const ALTURA_NO = 76

export interface Posicionado {
  x: number
  y: number
}

/** Uma aresta de volta não pode entrar no cálculo de camadas.
 *
 *  O dagre é um layout em camadas e resolveria o ciclo invertendo a aresta
 *  sozinho — o que puxaria o corpo da repetição para cima dela e embaralharia a
 *  ordem de leitura. Tirando a volta do cálculo, o corpo fica embaixo, na ordem
 *  em que executa, e a volta é desenhada por cima. */
const contaParaOLayout = (a: ArestaDoGrafo) => a.tipo !== 'volta'

export function posicionar(g: GrafoDesenhado): Map<string, Posicionado> {
  const grafo = new dagre.graphlib.Graph()
  grafo.setDefaultEdgeLabel(() => ({}))
  grafo.setGraph({
    // De cima para baixo: é como o fluxo já era lido na lista, e é a ordem em
    // que o motor executa. Da esquerda para a direita economizaria altura mas
    // trocaria a metáfora no meio da reforma.
    rankdir: 'TB',
    nodesep: 48,
    ranksep: 56,
    marginx: 24,
    marginy: 24,
  })

  for (const n of g.nos) grafo.setNode(n.id, { width: LARGURA_NO, height: ALTURA_NO })
  for (const a of g.arestas) {
    if (contaParaOLayout(a)) grafo.setEdge(a.de, a.para)
  }

  dagre.layout(grafo)

  const saida = new Map<string, Posicionado>()
  for (const n of g.nos) {
    const pos = grafo.node(n.id)
    // O dagre devolve o CENTRO do nó; o React Flow posiciona pelo canto
    // superior esquerdo. Sem esta conversão tudo fica meio nó deslocado, e o
    // erro só aparece como arestas que não encostam nos cartões.
    if (pos) saida.set(n.id, { x: pos.x - LARGURA_NO / 2, y: pos.y - ALTURA_NO / 2 })
  }
  return saida
}
