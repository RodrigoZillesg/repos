'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { TipoEtapa } from '@avexa/core'
import { Ponto } from '@/componentes/ui/cartao'
import { CORES, cn } from '@/lib/utils'
import { buscarEtapas, type EtapaEncontrada } from '@/lib/busca-etapas'

/** Achar uma etapa digitando, em vez de caçar em seis grupos.
 *
 *  É o gesto que mais economiza tempo de quem monta fluxo o dia inteiro:
 *  Ctrl+K, três letras, Enter. Ctrl+K e não Tab — que é o que o n8n usa —
 *  porque sequestrar o Tab quebraria a navegação por teclado do resto da tela,
 *  e o editor inteiro é operável sem mouse.
 *
 *  Sem biblioteca: são dezesseis tipos, e o que se precisa aqui é filtrar,
 *  andar com as setas e confirmar. */

interface Props {
  canais: Record<string, boolean>
  aoEscolher: (tipo: TipoEtapa) => void
  aoFechar: () => void
}

export function BuscadorDeEtapas({ canais, aoEscolher, aoFechar }: Props) {
  const [termo, setTermo] = useState('')
  const [foco, setFoco] = useState(0)
  const campo = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  const achadas = useMemo(() => buscarEtapas(termo, canais), [termo, canais])
  // Digitar muda a lista: o destaque volta para o topo, senão ele ficaria numa
  // posição que já é outra etapa.
  useEffect(() => setFoco(0), [termo])
  useEffect(() => campo.current?.focus(), [])

  // Mantém o item destacado visível ao andar com as setas.
  useEffect(() => {
    lista.current?.querySelector('[data-focado="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [foco])

  const escolher = (e: EtapaEncontrada | undefined) => {
    if (!e || e.bloqueada) return
    aoEscolher(e.tipo)
    aoFechar()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={aoFechar}
    >
      <div
        role="dialog"
        aria-label="Adicionar etapa"
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-cartao)] border bg-[var(--color-superficie)] shadow-lg"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden size={14} className="shrink-0 text-[var(--color-tinta-3)]" />
          <input
            ref={campo}
            value={termo}
            onChange={(ev) => setTermo(ev.target.value)}
            placeholder="Procurar etapa…"
            aria-label="Procurar etapa"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-tinta-3)]"
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') return aoFechar()
              if (ev.key === 'ArrowDown') {
                ev.preventDefault()
                setFoco((i) => Math.min(i + 1, achadas.length - 1))
              } else if (ev.key === 'ArrowUp') {
                ev.preventDefault()
                setFoco((i) => Math.max(i - 1, 0))
              } else if (ev.key === 'Enter') {
                ev.preventDefault()
                escolher(achadas[foco])
              }
            }}
          />
        </div>

        <div ref={lista} className="max-h-80 overflow-y-auto p-1.5">
          {achadas.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-[var(--color-tinta-3)]">
              Nenhuma etapa com “{termo}”.
            </p>
          ) : (
            achadas.map((e, i) => (
              <button
                key={e.tipo}
                type="button"
                data-focado={i === foco}
                disabled={e.bloqueada}
                onMouseMove={() => setFoco(i)}
                onClick={() => escolher(e)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40',
                  i === foco && !e.bloqueada && 'bg-[var(--color-acento-suave)]',
                )}
              >
                <Ponto cor={CORES[e.tipo] ?? 'var(--color-logica)'} />
                <span className="flex-1">{e.nome}</span>
                {e.bloqueada ? (
                  <span className="text-[11px] text-[var(--color-alerta)]">não contratado</span>
                ) : (
                  <span className="text-[11px] text-[var(--color-tinta-3)]">{e.grupo}</span>
                )}
              </button>
            ))
          )}
        </div>

        <p className="border-t px-3 py-2 text-[11px] text-[var(--color-tinta-3)]">
          ↑↓ para andar · Enter para inserir · Esc para fechar
        </p>
      </div>
    </div>
  )
}
