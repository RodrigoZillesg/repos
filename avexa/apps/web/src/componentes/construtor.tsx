'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { List, Plus, Redo2, TriangleAlert, Undo2, Workflow, X } from 'lucide-react'
import {
  ETAPAS,
  GRUPOS,
  cfgPadrao,
  validarGrafo,
  type Achado,
  type Canal,
  type Etapa,
  type Grafo,
  type LimitesMotor,
  type TipoEtapa,
} from '@avexa/core'
import { Simulacao } from '@/componentes/simulacao'
import { CanvasFluxo } from '@/componentes/canvas-fluxo'
import { BuscadorDeEtapas } from '@/componentes/buscador-etapas'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, AreaTexto, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES, cn } from '@/lib/utils'
import type { Chave } from '@/i18n/dicionario'

interface Props {
  grafoInicial: Grafo
  canais: Record<string, boolean>
  templates: Record<string, string[]>
  fluxos: Array<{ id: string; nome: string }>
  /** As agendas que o cliente configurou em Integrações. É a lista de destinos
   *  possíveis do nó "Agendar reunião" — sem ela, escolher agenda seria digitar
   *  um id de cabeça. */
  agendas: Array<{ id: string; nome: string }>
  fluxoId: string
  podeEditar: boolean
  limites: LimitesMotor
  fuso: string
  templatesAprovados: Record<string, string[]>
  t: Record<Chave, string>
  aoSalvar: (
    fluxoId: string,
    grafo: Grafo,
    publicar: boolean,
  ) => Promise<{ ok: boolean; erro?: string; achados?: Achado[] }>
}

const novoId = () => Math.random().toString(36).slice(2, 10)

function criarEtapa(tipo: TipoEtapa): Etapa {
  const e: Etapa = { id: novoId(), tipo, cfg: cfgPadrao(tipo) }
  // Condição e repetição nascem com um caminho cada, porque um ramo vazio é uma
  // armadilha: o fluxo simplesmente pula e ninguém entende por quê.
  if (ETAPAS[tipo].ramos) {
    e.sim = [{ id: novoId(), tipo: 'entregar', cfg: cfgPadrao('entregar') }]
    e.nao = [{ id: novoId(), tipo: 'encerrar', cfg: cfgPadrao('encerrar') }]
  }
  if (ETAPAS[tipo].corpo) {
    e.corpo = [{ id: novoId(), tipo: 'espera', cfg: cfgPadrao('espera') }]
  }
  return e
}

/** Localiza uma etapa na árvore e devolve a lista que a contém. */
function achar(lista: Etapa[], id: string): { etapa: Etapa; lista: Etapa[]; indice: number } | null {
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i]!
    if (e.id === id) return { etapa: e, lista, indice: i }
    for (const ramo of ['sim', 'nao', 'corpo'] as const) {
      const filhos = e[ramo]
      if (filhos) {
        const r = achar(filhos, id)
        if (r) return r
      }
    }
  }
  return null
}

const clonar = (g: Grafo): Grafo => structuredClone(g)

export function Construtor(p: Props) {
  const [grafo, setGrafo] = useState<Grafo>(p.grafoInicial)
  const [sel, setSel] = useState<string | null>(p.grafoInicial[0]?.id ?? null)
  const [sujo, setSujo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [simulando, setSimulando] = useState(false)
  const [pendente, iniciar] = useTransition()
  // Pilhas de desfazer/refazer. `mutar` já clonava o grafo inteiro a cada
  // alteração, então guardar o anterior custa o que já estava sendo pago.
  const [desfazer, setDesfazer] = useState<Grafo[]>([])
  const [refazer, setRefazer] = useState<Grafo[]>([])
  /** Achados da última publicação, que carregam `etapaId` do servidor. */
  const [doServidor, setDoServidor] = useState<Achado[]>([])
  /** Lista ou canvas. A lista continua sendo de primeira classe: é a superfície
   *  navegável por teclado, e quem revisa um fluxo longo lê melhor nela. */
  const [visao, setVisao] = useState<'lista' | 'canvas'>('canvas')
  /** Etapas por onde a última simulação passou. `EventoSimulado.etapaId` sempre
   *  existiu e nunca tinha chegado ao desenho. */
  const [percorridas, setPercorridas] = useState<Set<string>>(new Set())
  /** Paleta com busca: Ctrl+K, ou o "+" de uma aresta. */
  const [buscando, setBuscando] = useState(false)
  /** Onde a próxima etapa entra: antes desta. `null` põe no fim do fluxo. */
  const [alvoDaInsercao, setAlvoDaInsercao] = useState<string | null>(null)

  const selecionada = useMemo(() => (sel ? achar(grafo, sel) : null), [grafo, sel])

  /** Validação enquanto se edita, não só ao publicar.
   *
   *  As mesmas regras que o servidor aplica — `validarGrafo` vem de core e roda
   *  nos dois lados. Aqui ela serve para marcar o nó; lá ela decide se publica.
   *  O servidor continua sendo quem manda: esconder botão não é controle. */
  const achados = useMemo(
    () =>
      validarGrafo(grafo, {
        canaisAtivos: p.canais,
        templatesAprovados: p.templatesAprovados as Partial<Record<Canal, string[]>>,
        fluxosDoCliente: p.fluxos.filter((f) => f.id !== p.fluxoId),
      }),
    [grafo, p.canais, p.templatesAprovados, p.fluxos, p.fluxoId],
  )

  /** Achados por etapa, para o cartão saber o que mostrar sem varrer a lista. */
  const porEtapa = useMemo(() => {
    const m = new Map<string, Achado[]>()
    for (const a of [...achados, ...doServidor]) {
      if (a.etapaId) m.set(a.etapaId, [...(m.get(a.etapaId) ?? []), a])
    }
    return m
  }, [achados, doServidor])

  /** Achados sem etapa: valem para o fluxo inteiro. */
  const doFluxo = useMemo(() => achados.filter((a) => !a.etapaId), [achados])

  const todos = useMemo(() => [...achados, ...doServidor], [achados, doServidor])
  const quantosErros = todos.filter((a) => a.gravidade === 'erro').length
  const quantosAvisos = todos.length - quantosErros

  function mutar(f: (g: Grafo) => void) {
    const g = clonar(grafo)
    f(g)
    setDesfazer((d) => [...d.slice(-49), grafo])
    setRefazer([])
    setGrafo(g)
    setSujo(true)
    // O resultado da última publicação deixa de valer assim que o grafo muda:
    // manter aquele erro na tela apontaria para uma etapa que talvez nem exista
    // mais.
    setDoServidor([])
  }

  function voltarUmPasso() {
    setDesfazer((d) => {
      const anterior = d[d.length - 1]
      if (!anterior) return d
      setRefazer((r) => [...r, grafo])
      setGrafo(anterior)
      setSujo(true)
      return d.slice(0, -1)
    })
  }

  function refazerUmPasso() {
    setRefazer((r) => {
      const proximo = r[r.length - 1]
      if (!proximo) return r
      setDesfazer((d) => [...d, grafo])
      setGrafo(proximo)
      setSujo(true)
      return r.slice(0, -1)
    })
  }

  function inserir(tipo: TipoEtapa, alvoId?: string) {
    const nova = criarEtapa(tipo)
    mutar((g) => {
      if (!alvoId) {
        g.push(nova)
        return
      }
      const r = achar(g, alvoId)
      if (r) r.lista.splice(r.indice, 0, nova)
      else g.push(nova)
    })
    setSel(nova.id)
  }

  /** Ctrl+Z / Ctrl+Shift+Z.
   *
   *  Ignora quando o foco está num campo de texto: dentro do inspetor, Ctrl+Z
   *  tem que desfazer a digitação, não a última alteração do fluxo. */
  useEffect(() => {
    if (!p.podeEditar) return
    const naTela = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement | null
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return
      if (!(ev.ctrlKey || ev.metaKey)) return
      const tecla = ev.key.toLowerCase()
      if (tecla === 'k') {
        // Ctrl+K, e não Tab como no n8n: sequestrar o Tab quebraria a
        // navegação por teclado do resto da tela.
        ev.preventDefault()
        setAlvoDaInsercao(null)
        setBuscando(true)
        return
      }
      if (tecla !== 'z') return
      ev.preventDefault()
      if (ev.shiftKey) refazerUmPasso()
      else voltarUmPasso()
    }
    window.addEventListener('keydown', naTela)
    return () => window.removeEventListener('keydown', naTela)
  })

  function salvar(publicar: boolean) {
    iniciar(async () => {
      const r = await p.aoSalvar(p.fluxoId, grafo, publicar)
      setAviso(r.ok ? null : (r.erro ?? 'falhou'))
      // Os achados do servidor vêm com `etapaId` e marcam o nó. É a diferença
      // entre "o template X não está aprovado" e saber em QUAL das três etapas
      // de WhatsApp o problema está.
      setDoServidor(r.achados ?? [])
      if (r.ok) setSujo(false)
    })
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[230px_1fr_320px]">
      {/* Trilho: canais contratados e paleta de etapas */}
      <aside className="hidden flex-col gap-5 overflow-y-auto border-r p-4 lg:flex">
        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--color-tinta-3)]">
            {p.t['fluxos.canais']}
          </h3>
          <ul className="space-y-1.5">
            {(['ligacao', 'whatsapp', 'sms', 'email'] as const).map((c) => (
              <li key={c} className="flex items-center gap-2 text-[13px]">
                <Ponto cor={CORES[c]!} />
                <span className="flex-1">{ETAPAS[c].nome}</span>
                {!p.canais[c] && <Selo>{p.t['fluxos.off']}</Selo>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--color-tinta-3)]">
            {p.t['fluxos.adicionar']}
          </h3>
          <Paleta canais={p.canais} desabilitado={!p.podeEditar} aoEscolher={(tipo) => inserir(tipo)} />
          <Ajuda>{p.t['fluxos.dica']}</Ajuda>
        </section>
      </aside>

      {/* Pilha do fluxo */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          {sujo && <Selo tom="alerta">alterações não salvas</Selo>}
          {aviso && <Selo tom="alerta">{aviso}</Selo>}
          {/* Contagem viva, não só ao publicar. Um fluxo com erro dizia-se
              pronto até alguém tentar publicar. */}
          {quantosErros > 0 && <Selo tom="perigo">{quantosErros} com erro</Selo>}
          {quantosErros === 0 && quantosAvisos > 0 && (
            <Selo tom="alerta">{quantosAvisos} com aviso</Selo>
          )}
          <div className="ml-auto flex gap-2">
            <div className="flex overflow-hidden rounded-lg border">
              {(['canvas', 'lista'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisao(v)}
                  aria-pressed={visao === v}
                  className={cn(
                    'px-2.5 py-1 text-[12px]',
                    visao === v
                      ? 'bg-[var(--color-acento-suave)] text-[var(--color-acento)]'
                      : 'text-[var(--color-tinta-2)]',
                  )}
                >
                  {v === 'canvas' ? (
                    <Workflow aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <List aria-hidden className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only">{v === 'canvas' ? 'Ver como fluxo' : 'Ver como lista'}</span>
                </button>
              ))}
            </div>
            {p.podeEditar && (
              <>
                {/* O atalho fica escrito: ninguém descobre Ctrl+K sozinho. */}
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  onClick={() => {
                    setAlvoDaInsercao(null)
                    setBuscando(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Etapa
                  <kbd className="ml-1 rounded border px-1 text-[10px] text-[var(--color-tinta-3)]">
                    Ctrl K
                  </kbd>
                </Botao>
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  disabled={desfazer.length === 0}
                  onClick={voltarUmPasso}
                  title="Desfazer (Ctrl+Z)"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Desfazer</span>
                </Botao>
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  disabled={refazer.length === 0}
                  onClick={refazerUmPasso}
                  title="Refazer (Ctrl+Shift+Z)"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Refazer</span>
                </Botao>
              </>
            )}
            {/* Simula o grafo que está na tela, inclusive o que ainda não foi
                salvo: conferir depois de publicar seria conferir com lead real. */}
            <Botao variante="contorno" tamanho="pequeno" onClick={() => setSimulando(true)}>
              {p.t['comum.simular']}
            </Botao>
            <Botao
              variante="contorno"
              tamanho="pequeno"
              disabled={!p.podeEditar || !sujo || pendente}
              onClick={() => salvar(false)}
            >
              {p.t['comum.salvar']}
            </Botao>
            <Botao
              tamanho="pequeno"
              disabled={!p.podeEditar || pendente}
              onClick={() => salvar(true)}
            >
              {p.t['comum.publicar']}
            </Botao>
          </div>
        </div>

        {visao === 'canvas' ? (
          <div className="min-h-0 flex-1">
            <CanvasFluxo
              grafo={grafo}
              sel={sel}
              canais={p.canais}
              porEtapa={porEtapa}
              percorridas={percorridas}
              podeEditar={p.podeEditar}
              aoSelecionar={setSel}
              aoInserirAntes={(alvoId) => {
                setAlvoDaInsercao(alvoId)
                setBuscando(true)
              }}
            />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Pilha
            lista={grafo}
            sel={sel}
            canais={p.canais}
            podeEditar={p.podeEditar}
            porEtapa={porEtapa}
            aoSelecionar={setSel}
            aoInserirAntes={inserir}
          />
          {p.podeEditar && (
            <div className="mt-2 flex justify-center">
              <MenuInserir canais={p.canais} aoEscolher={(tipo) => inserir(tipo)} />
            </div>
          )}

          {/* Os problemas do fluxo inteiro, que não pertencem a etapa nenhuma —
              "nenhuma etapa de canal", por exemplo. Os de etapa aparecem no
              próprio cartão; repeti-los aqui seria pedir para o operador ler a
              mesma coisa duas vezes. */}
          {doFluxo.length > 0 && (
            <ul className="mt-5 space-y-1.5">
              {doFluxo.map((a, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs leading-snug"
                  style={{
                    color: a.gravidade === 'erro' ? 'var(--color-perigo)' : 'var(--color-alerta)',
                  }}
                >
                  <TriangleAlert aria-hidden size={13} className="mt-0.5 shrink-0" />
                  {a.mensagem}
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>

      {/* Inspetor da etapa */}
      <aside className="overflow-y-auto border-l p-4">
        {selecionada ? (
          <Inspetor
            etapa={selecionada.etapa}
            templates={p.templates}
            fluxos={p.fluxos.filter((f) => f.id !== p.fluxoId)}
            agendas={p.agendas}
            podeEditar={p.podeEditar}
            t={p.t}
            aoMudar={(chave, valor) =>
              mutar((g) => {
                const r = achar(g, selecionada.etapa.id)
                if (r) r.etapa.cfg[chave] = valor
              })
            }
            aoMover={(delta) =>
              mutar((g) => {
                const r = achar(g, selecionada.etapa.id)
                if (!r) return
                const destino = r.indice + delta
                if (destino < 0 || destino >= r.lista.length) return
                const [x] = r.lista.splice(r.indice, 1)
                r.lista.splice(destino, 0, x!)
              })
            }
            aoRemover={() => {
              mutar((g) => {
                const r = achar(g, selecionada.etapa.id)
                if (r) r.lista.splice(r.indice, 1)
              })
              setSel(grafo[0]?.id ?? null)
            }}
          />
        ) : (
          <p className="text-[13px] text-[var(--color-tinta-3)]">{p.t['fluxos.escolha']}</p>
        )}
      </aside>

      {buscando && (
        <BuscadorDeEtapas
          canais={p.canais}
          aoEscolher={(tipo) => inserir(tipo, alvoDaInsercao ?? undefined)}
          aoFechar={() => setBuscando(false)}
        />
      )}

      {simulando && (
        <Simulacao
          grafo={grafo}
          canais={p.canais}
          templatesAprovados={p.templatesAprovados}
          fluxosDoCliente={p.fluxos.filter((f) => f.id !== p.fluxoId)}
          limites={p.limites}
          fuso={p.fuso}
          t={p.t}
          aoPercurso={setPercorridas}
          aoFechar={() => setSimulando(false)}
        />
      )}
    </div>
  )
}

function Pilha({
  lista,
  sel,
  canais,
  podeEditar,
  porEtapa,
  aoSelecionar,
  aoInserirAntes,
  nivel = 0,
}: {
  lista: Etapa[]
  sel: string | null
  canais: Record<string, boolean>
  podeEditar: boolean
  /** Problemas de cada etapa, para marcar o cartão. */
  porEtapa: Map<string, Achado[]>
  aoSelecionar: (id: string) => void
  aoInserirAntes: (tipo: TipoEtapa, alvoId: string) => void
  nivel?: number
}) {
  return (
    <ol className={cn('space-y-0', nivel > 0 && 'ml-5 border-l pl-4')}>
      {lista.map((e) => {
        const def = ETAPAS[e.tipo]
        const desligado = def.canal && !canais[def.canal]
        const problemas = porEtapa.get(e.id) ?? []
        const temErroAqui = problemas.some((a) => a.gravidade === 'erro')
        return (
          <li key={e.id}>
            {podeEditar && (
              <div className="flex justify-center py-0.5">
                <MenuInserir canais={canais} aoEscolher={(tipo) => aoInserirAntes(tipo, e.id)} miudo />
              </div>
            )}

            <button
              type="button"
              onClick={() => aoSelecionar(e.id)}
              aria-current={sel === e.id}
              className={cn(
                'flex w-full items-center gap-3 rounded-[var(--radius-cartao)] border bg-[var(--color-superficie)] px-3 py-2.5 text-left transition-colors',
                sel === e.id
                  ? 'border-[var(--color-acento)] ring-1 ring-[var(--color-acento)]'
                  : temErroAqui
                    ? 'border-[var(--color-perigo)]'
                    : problemas.length > 0
                      ? 'border-[var(--color-alerta)]'
                      : 'hover:border-[var(--color-tinta-3)]',
              )}
            >
              <span
                aria-hidden
                className="h-8 w-1 shrink-0 rounded-full"
                style={{ background: CORES[e.tipo] ?? 'var(--color-logica)' }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{def.nome}</span>
                <span className="block truncate text-xs text-[var(--color-tinta-3)]">
                  {def.resumo(e.cfg)}
                </span>
                {/* O problema escrito no próprio cartão. Antes ele existia só
                    numa lista à parte, e descobrir a qual das três etapas de
                    WhatsApp ele se referia era com o operador. */}
                {problemas.length > 0 && (
                  <span
                    className="mt-1 block text-xs leading-snug"
                    style={{ color: temErroAqui ? 'var(--color-perigo)' : 'var(--color-alerta)' }}
                  >
                    {problemas[0]!.mensagem}
                    {problemas.length > 1 && ` (+${problemas.length - 1})`}
                  </span>
                )}
              </span>
              {problemas.length > 0 && (
                <TriangleAlert
                  aria-hidden
                  size={14}
                  className="shrink-0"
                  style={{ color: temErroAqui ? 'var(--color-perigo)' : 'var(--color-alerta)' }}
                />
              )}
              {desligado && <Selo tom="alerta">off</Selo>}
            </button>

            {(['sim', 'nao', 'corpo'] as const).map((ramo) =>
              e[ramo] ? (
                <div key={ramo} className="mt-1">
                  <span className="ml-5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-tinta-3)]">
                    {ramo === 'sim' ? 'sim' : ramo === 'nao' ? 'não' : 'repete'}
                  </span>
                  <Pilha
                    lista={e[ramo]!}
                    sel={sel}
                    canais={canais}
                    podeEditar={podeEditar}
                    porEtapa={porEtapa}
                    aoSelecionar={aoSelecionar}
                    aoInserirAntes={aoInserirAntes}
                    nivel={nivel + 1}
                  />
                </div>
              ) : null,
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Paleta({
  canais,
  desabilitado,
  aoEscolher,
}: {
  canais: Record<string, boolean>
  desabilitado?: boolean
  aoEscolher: (tipo: TipoEtapa) => void
}) {
  return (
    <div className="space-y-3">
      {GRUPOS.map((grupo) => {
        const itens = (Object.entries(ETAPAS) as Array<[TipoEtapa, (typeof ETAPAS)[TipoEtapa]]>)
          .filter(([, d]) => d.grupo === grupo && !d.fixa)
        if (itens.length === 0) return null
        return (
          <div key={grupo}>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-tinta-3)]">
              {grupo}
            </p>
            <div className="space-y-0.5">
              {itens.map(([tipo, d]) => (
                <button
                  key={tipo}
                  type="button"
                  disabled={desabilitado || (!!d.canal && !canais[d.canal])}
                  onClick={() => aoEscolher(tipo)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-acento-suave)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Ponto cor={CORES[tipo] ?? 'var(--color-logica)'} />
                  {d.nome}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MenuInserir({
  canais,
  aoEscolher,
  miudo,
}: {
  canais: Record<string, boolean>
  aoEscolher: (tipo: TipoEtapa) => void
  miudo?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="Inserir etapa"
        onClick={() => setAberto(true)}
        className={cn(
          'grid place-items-center rounded-full border border-dashed text-[var(--color-tinta-3)] transition-colors hover:border-[var(--color-acento)] hover:text-[var(--color-acento)]',
          miudo ? 'h-5 w-5' : 'h-7 w-7',
        )}
      >
        <Plus size={miudo ? 11 : 14} />
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onClick={() => setAberto(false)}
        >
          <Cartao
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center">
              <h2 className="text-sm font-semibold">Adicionar etapa</h2>
              <Botao
                variante="fantasma"
                tamanho="icone"
                className="ml-auto"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
              >
                <X size={14} />
              </Botao>
            </div>
            <Paleta
              canais={canais}
              aoEscolher={(tipo) => {
                aoEscolher(tipo)
                setAberto(false)
              }}
            />
          </Cartao>
        </div>
      )}
    </>
  )
}

function Inspetor({
  etapa,
  templates,
  fluxos,
  agendas,
  podeEditar,
  t,
  aoMudar,
  aoMover,
  aoRemover,
}: {
  etapa: Etapa
  templates: Record<string, string[]>
  fluxos: Array<{ id: string; nome: string }>
  agendas: Array<{ id: string; nome: string }>
  podeEditar: boolean
  t: Record<Chave, string>
  aoMudar: (chave: string, valor: string) => void
  aoMover: (delta: number) => void
  aoRemover: () => void
}) {
  const def = ETAPAS[etapa.tipo]

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Ponto cor={CORES[etapa.tipo] ?? 'var(--color-logica)'} />
        <h2 className="text-sm font-semibold">{def.nome}</h2>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-tinta-2)]">{def.descricao}</p>

      {def.campos.map((campo) => {
        if (campo.visivelSe && !campo.visivelSe(etapa.cfg)) return null
        const valor = etapa.cfg[campo.k] ?? ''
        const id = `c_${campo.k}`

        return (
          <div key={campo.k} className="mb-3">
            <Rotulo htmlFor={id}>{campo.rotulo}</Rotulo>

            {campo.tipo === 'select' && (
              <Selecao
                id={id}
                value={valor}
                disabled={!podeEditar}
                onChange={(e) => aoMudar(campo.k, e.target.value)}
              >
                {campo.opcoes?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Selecao>
            )}

            {campo.tipo === 'template' && (
              <>
                <Selecao
                  id={id}
                  value={valor}
                  disabled={!podeEditar}
                  onChange={(e) => aoMudar(campo.k, e.target.value)}
                >
                  <option value="">—</option>
                  {(templates[campo.canalTemplate ?? ''] ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Selecao>
                <Ajuda>{t['templates.avisoTexto']}</Ajuda>
              </>
            )}

            {campo.tipo === 'fluxo' && (
              <Selecao
                id={id}
                value={valor}
                disabled={!podeEditar}
                onChange={(e) => aoMudar(campo.k, e.target.value)}
              >
                <option value="">—</option>
                {/* `value` explícito: sem ele o valor da opção vira o TEXTO, e
                    a etapa passa a referenciar o fluxo pelo nome. Renomear o
                    fluxo quebrava a chamada em silêncio, em execução. */}
                {fluxos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
                {/* Referência antiga, gravada por nome. Fica visível para poder
                    ser reescolhida, em vez de o campo voltar sozinho para "—" e
                    trocar o destino sem ninguém ver. */}
                {valor && !fluxos.some((f) => f.id === valor) && (
                  <option value={valor}>{valor} (referência antiga, reescolha)</option>
                )}
              </Selecao>
            )}

            {campo.tipo === 'agenda' && (
              <>
                <Selecao
                  id={id}
                  value={valor}
                  disabled={!podeEditar}
                  onChange={(e) => aoMudar(campo.k, e.target.value)}
                >
                  <option value="">Todas as agendas configuradas</option>
                  {agendas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                  {/* Agenda escolhida que saiu da lista do cliente: aparece para
                      poder ser trocada, em vez de o campo voltar sozinho para
                      "todas" e mudar o destino sem ninguém ver. */}
                  {valor && !agendas.some((a) => a.id === valor) && (
                    <option value={valor}>{valor} (fora das configuradas)</option>
                  )}
                </Selecao>
                <Ajuda>
                  {agendas.length === 0
                    ? 'Este cliente ainda não escolheu agendas em Integrações. Enquanto isso, o nó não tem onde marcar.'
                    : 'Dois nós de agendamento podem mirar times diferentes — é assim que o fluxo roteia a reunião.'}
                </Ajuda>
              </>
            )}

            {campo.tipo === 'url' && (
              <>
                <div className="flex gap-1.5">
                  <Entrada id={id} value={valor} readOnly className="font-mono text-xs" />
                  <Botao
                    variante="contorno"
                    tamanho="pequeno"
                    onClick={() => void navigator.clipboard?.writeText(valor)}
                  >
                    {t['comum.copiar']}
                  </Botao>
                </div>
                <Ajuda>
                  Entregue este endereço ao cliente. Ele cola na saída do formulário, no CRM ou em
                  qualquer fonte de lead. Cada fluxo tem o seu.
                </Ajuda>
              </>
            )}

            {campo.tipo === 'textarea' && (
              <AreaTexto
                id={id}
                value={valor}
                disabled={!podeEditar}
                onChange={(e) => aoMudar(campo.k, e.target.value)}
              />
            )}

            {campo.tipo === 'texto' && (
              <Entrada
                id={id}
                value={valor}
                disabled={!podeEditar}
                onChange={(e) => aoMudar(campo.k, e.target.value)}
              />
            )}
          </div>
        )
      })}

      {def.fixa && <p className="mt-3 text-xs text-[var(--color-tinta-3)]">{t['fluxos.fixa']}</p>}

      {podeEditar && !def.fixa && (
        <div className="mt-5 flex flex-wrap gap-1.5 border-t pt-3">
          <Botao variante="contorno" tamanho="pequeno" onClick={() => aoMover(-1)}>
            {t['fluxos.subir']}
          </Botao>
          <Botao variante="contorno" tamanho="pequeno" onClick={() => aoMover(1)}>
            {t['fluxos.descer']}
          </Botao>
          <Botao variante="perigo" tamanho="pequeno" className="ml-auto" onClick={aoRemover}>
            {t['comum.remover']}
          </Botao>
        </div>
      )}
    </div>
  )
}
