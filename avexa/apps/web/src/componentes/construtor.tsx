'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import {
  ETAPAS,
  GRUPOS,
  cfgPadrao,
  type Etapa,
  type Grafo,
  type LimitesMotor,
  type TipoEtapa,
} from '@avexa/core'
import { Simulacao } from '@/componentes/simulacao'
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
  aoSalvar: (fluxoId: string, grafo: Grafo, publicar: boolean) => Promise<{ ok: boolean; erro?: string }>
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

  const selecionada = useMemo(() => (sel ? achar(grafo, sel) : null), [grafo, sel])

  function mutar(f: (g: Grafo) => void) {
    const g = clonar(grafo)
    f(g)
    setGrafo(g)
    setSujo(true)
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

  function salvar(publicar: boolean) {
    iniciar(async () => {
      const r = await p.aoSalvar(p.fluxoId, grafo, publicar)
      setAviso(r.ok ? null : (r.erro ?? 'falhou'))
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
          <div className="ml-auto flex gap-2">
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

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Pilha
            lista={grafo}
            sel={sel}
            canais={p.canais}
            podeEditar={p.podeEditar}
            aoSelecionar={setSel}
            aoInserirAntes={inserir}
          />
          {p.podeEditar && (
            <div className="mt-2 flex justify-center">
              <MenuInserir canais={p.canais} aoEscolher={(tipo) => inserir(tipo)} />
            </div>
          )}
        </div>
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

      {simulando && (
        <Simulacao
          grafo={grafo}
          canais={p.canais}
          templatesAprovados={p.templatesAprovados}
          fluxosDoCliente={p.fluxos.filter((f) => f.id !== p.fluxoId).map((f) => f.nome)}
          limites={p.limites}
          fuso={p.fuso}
          t={p.t}
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
  aoSelecionar,
  aoInserirAntes,
  nivel = 0,
}: {
  lista: Etapa[]
  sel: string | null
  canais: Record<string, boolean>
  podeEditar: boolean
  aoSelecionar: (id: string) => void
  aoInserirAntes: (tipo: TipoEtapa, alvoId: string) => void
  nivel?: number
}) {
  return (
    <ol className={cn('space-y-0', nivel > 0 && 'ml-5 border-l pl-4')}>
      {lista.map((e) => {
        const def = ETAPAS[e.tipo]
        const desligado = def.canal && !canais[def.canal]
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
              </span>
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
                {fluxos.map((f) => (
                  <option key={f.id}>{f.nome}</option>
                ))}
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
