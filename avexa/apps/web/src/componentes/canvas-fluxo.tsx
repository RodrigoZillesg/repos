'use client'

import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { TriangleAlert } from 'lucide-react'
import { ETAPAS, aplanar, preencherPercurso, type Achado, type Etapa, type Grafo } from '@avexa/core'
import { CORES } from '@/lib/utils'
import { ALTURA_NO, LARGURA_NO, posicionar } from '@/lib/posicionar'

/** O fluxo desenhado como grafo.
 *
 *  Uma VISÃO, nunca o modelo: a árvore em `Grafo` continua sendo a única fonte
 *  de verdade, e as arestas aqui são derivadas por `aplanar` em vez de
 *  desenhadas. Arrastar não religa nada — quem move uma etapa usa o inspetor,
 *  que continua sendo a superfície de edição.
 *
 *  Isso é de propósito. Um canvas de arestas livres deixaria desenhar coisa que
 *  o motor não executa, e nestes fluxos uma aresta trocada por um erro de mouse
 *  é uma IA ligando para quem pediu para não ser procurado. */

export interface DadosDoNo extends Record<string, unknown> {
  etapa: Etapa
  selecionado: boolean
  desligado: boolean
  problemas: Achado[]
  /** Etapa por onde a simulação passou. */
  percorrido: boolean
  /** Alguma simulação rodou? Antes disso não se esmaece ninguém. */
  temPercurso: boolean
}

function CartaoDoNo({ data }: NodeProps<Node<DadosDoNo>>) {
  const { etapa, selecionado, desligado, problemas, percorrido, temPercurso } = data
  const def = ETAPAS[etapa.tipo]
  const temErro = problemas.some((a) => a.gravidade === 'erro')
  const cor = CORES[etapa.tipo] ?? 'var(--color-logica)'

  const borda = selecionado
    ? 'var(--color-acento)'
    : temErro
      ? 'var(--color-perigo)'
      : problemas.length > 0
        ? 'var(--color-alerta)'
        : 'var(--color-borda)'

  return (
    <div
      className="flex items-center gap-2.5 rounded-[var(--radius-cartao)] border bg-[var(--color-superficie)] px-3 py-2.5"
      style={{
        width: LARGURA_NO,
        height: ALTURA_NO,
        borderColor: borda,
        ...(selecionado ? { boxShadow: `0 0 0 1px ${borda}` } : {}),
        // Etapa que a simulação não percorreu fica apagada em vez de sumir:
        // some quem lê saberia que ela existe.
        ...(temPercurso && !percorrido ? { opacity: 0.45 } : {}),
      }}
    >
      {/* As portas. `isConnectable={false}`: são pontos de ancoragem do
          desenho, não convite para ligar à mão. */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span aria-hidden className="h-9 w-1 shrink-0 rounded-full" style={{ background: cor }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{def.nome}</span>
        {/* O resumo é o que permite ler o fluxo inteiro sem abrir cada etapa.
            É a primeira coisa que um canvas costuma matar; aqui ele fica. */}
        <span className="block truncate text-[11px] leading-snug text-[var(--color-tinta-3)]">
          {def.resumo(etapa.cfg)}
        </span>
        {problemas.length > 0 && (
          <span
            className="block truncate text-[11px]"
            style={{ color: temErro ? 'var(--color-perigo)' : 'var(--color-alerta)' }}
          >
            {problemas[0]!.mensagem}
          </span>
        )}
      </span>
      {problemas.length > 0 && (
        <TriangleAlert
          aria-hidden
          size={13}
          className="shrink-0"
          style={{ color: temErro ? 'var(--color-perigo)' : 'var(--color-alerta)' }}
        />
      )}
      {desligado && (
        <span className="shrink-0 rounded-full border border-[var(--color-alerta)] px-1.5 text-[10px] text-[var(--color-alerta)]">
          off
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}

const tiposDeNo = { etapa: CartaoDoNo }

interface Props {
  grafo: Grafo
  sel: string | null
  canais: Record<string, boolean>
  porEtapa: Map<string, Achado[]>
  /** Etapas por onde a última simulação passou. Vazio antes de simular. */
  percorridas: Set<string>
  aoSelecionar: (id: string) => void
}

function Tela({ grafo, sel, canais, porEtapa, percorridas, aoSelecionar }: Props) {
  const { nos, arestas } = useMemo(() => {
    const desenhado = aplanar(grafo)
    const posicoes = posicionar(desenhado)
    // As etapas que emitiram evento, mais as que foram atravessadas em
    // silêncio. Sem preencher, a entrada e a guarda apareceriam apagadas como
    // se o lead não tivesse passado por elas — e foi a guarda que o deixou
    // seguir.
    const noCaminho = preencherPercurso(desenhado, [...percorridas])
    const temPercurso = noCaminho.size > 0

    const nos: Node<DadosDoNo>[] = desenhado.nos.map((n) => {
      const def = ETAPAS[n.etapa.tipo]
      return {
        id: n.id,
        type: 'etapa',
        position: posicoes.get(n.id) ?? { x: 0, y: 0 },
        // Medidas declaradas: sem elas o React Flow só sabe o tamanho depois de
        // medir no navegador, e o primeiro quadro sai com as arestas fora do
        // lugar.
        width: LARGURA_NO,
        height: ALTURA_NO,
        draggable: false,
        data: {
          etapa: n.etapa,
          selecionado: sel === n.id,
          desligado: Boolean(def.canal && !canais[def.canal]),
          problemas: porEtapa.get(n.id) ?? [],
          percorrido: noCaminho.has(n.id),
          temPercurso,
        },
      }
    })

    const arestas: Edge[] = desenhado.arestas.map((a) => {
      const viva = noCaminho.has(a.de) && noCaminho.has(a.para)
      return {
        id: a.id,
        source: a.de,
        target: a.para,
        type: 'smoothstep',
        ...(a.rotulo ? { label: a.rotulo } : {}),
        // A volta é tracejada: é o único caminho que anda para trás, e vê-la
        // como as outras faria o fluxo parecer ter dois começos.
        animated: a.tipo === 'volta',
        style: {
          stroke: viva ? 'var(--color-ok)' : 'var(--color-tinta-3)',
          strokeWidth: viva ? 2 : 1.5,
          ...(a.tipo === 'volta' ? { strokeDasharray: '4 3' } : {}),
          ...(temPercurso && !viva ? { opacity: 0.4 } : {}),
        },
        labelStyle: { fill: 'var(--color-tinta-2)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--color-fundo)' },
      }
    })

    return { nos, arestas }
  }, [grafo, sel, canais, porEtapa, percorridas])

  return (
    <ReactFlow
      nodes={nos}
      edges={arestas}
      nodeTypes={tiposDeNo}
      onNodeClick={(_, n) => aoSelecionar(n.id)}
      // Nada de religar: as arestas vêm da árvore.
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        // Cada ponto do minimapa com a cor do tipo de etapa: sem isso é um
        // borrão cinza que não ajuda a se localizar num fluxo longo.
        nodeColor={(n) => CORES[(n.data as DadosDoNo).etapa.tipo] ?? 'var(--color-logica)'}
        nodeStrokeWidth={0}
        maskColor="color-mix(in oklch, var(--color-fundo) 65%, transparent)"
        className="!border !border-[var(--color-borda)] !rounded-[var(--radius-cartao)]"
      />
    </ReactFlow>
  )
}

export function CanvasFluxo(p: Props) {
  return (
    <ReactFlowProvider>
      <Tela {...p} />
    </ReactFlowProvider>
  )
}
