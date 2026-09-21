'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  PERSONAS,
  simular,
  temErro,
  validarGrafo,
  type Canal,
  type Grafo,
  type LimitesMotor,
  type Persona,
  type EventoSimulado,
} from '@avexa/core'
import { Botao } from '@/componentes/ui/botao'
import { Selecao } from '@/componentes/ui/campo'
import { Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES, cn } from '@/lib/utils'
import type { Chave } from '@/i18n/dicionario'

interface Props {
  grafo: Grafo
  canais: Record<string, boolean>
  templatesAprovados: Record<string, string[]>
  fluxosDoCliente: Array<{ id: string; nome: string }>
  limites: LimitesMotor
  fuso: string
  t: Record<Chave, string>
  aoFechar: () => void
}

/** Console de simulação.
 *
 *  Roda o motor de verdade — o mesmo `simular` que os testes de CI usam — contra
 *  o grafo que está na tela, inclusive alterações ainda não salvas. É o que
 *  permite conferir um fluxo antes de publicar em vez de descobrir com lead de
 *  verdade. Nada sai daqui: o simulador não conhece adaptador nenhum. */
export function Simulacao(p: Props) {
  const [persona, setPersona] = useState<Persona>('morno')

  const achados = useMemo(
    () =>
      validarGrafo(p.grafo, {
        canaisAtivos: p.canais,
        templatesAprovados: p.templatesAprovados as Partial<Record<Canal, string[]>>,
        fluxosDoCliente: p.fluxosDoCliente,
      }),
    [p.grafo, p.canais, p.templatesAprovados, p.fluxosDoCliente],
  )

  const canaisAtivos = useMemo(
    () => (['ligacao', 'whatsapp', 'sms', 'email'] as const).filter((c) => p.canais[c]),
    [p.canais],
  )

  const resultado = useMemo(() => {
    try {
      return simular(p.grafo, persona, { canaisAtivos, limites: p.limites, fuso: p.fuso })
    } catch (e) {
      return { erro: e instanceof Error ? e.message : String(e) } as const
    }
  }, [p.grafo, persona, canaisAtivos, p.limites, p.fuso])

  const inicio = 'eventos' in resultado ? resultado.eventos[0]?.instante : undefined

  return (
    <section
      role="dialog"
      aria-label={p.t['sim.titulo']}
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] flex-col border-t bg-[var(--color-superficie)] shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{p.t['sim.titulo']}</h2>

        <label
          htmlFor="sim-persona"
          className="ml-2 text-xs text-[var(--color-tinta-3)]"
        >
          {p.t['sim.lead']}
        </label>
        <Selecao
          id="sim-persona"
          value={persona}
          onChange={(e) => setPersona(e.target.value as Persona)}
          className="h-7 w-auto text-[13px]"
        >
          {(Object.keys(PERSONAS) as Persona[]).map((k) => (
            <option key={k} value={k}>
              {PERSONAS[k]}
            </option>
          ))}
        </Selecao>

        {'eventos' in resultado && (
          <>
            <Selo tom={resultado.contatos > 0 ? 'acento' : 'neutro'}>
              {resultado.contatos} {p.t['sim.contatos']}
            </Selo>
            {resultado.respondeu && <Selo tom="ok">respondeu</Selo>}
            {resultado.suprimido && <Selo tom="alerta">pediu para parar</Selo>}
            <span className="text-xs text-[var(--color-tinta-3)]">{resultado.motivoFinal}</span>
          </>
        )}

        <Botao
          variante="fantasma"
          tamanho="icone"
          className="ml-auto"
          onClick={p.aoFechar}
          aria-label={p.t['comum.fechar']}
        >
          <X size={14} />
        </Botao>
      </header>

      {achados.length > 0 && (
        <div className="border-b px-4 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-[var(--color-tinta-3)]">
            {temErro(achados) ? 'Impede publicar' : 'Avisos'}
          </p>
          <ul className="space-y-1">
            {achados.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                <Selo tom={a.gravidade === 'erro' ? 'alerta' : 'neutro'} className="shrink-0">
                  {a.gravidade}
                </Selo>
                <span className="text-[var(--color-tinta-2)]">{a.mensagem}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {'erro' in resultado ? (
          <p className="text-xs text-[var(--color-alerta)]">
            O simulador não conseguiu rodar este fluxo: {resultado.erro}
          </p>
        ) : (
          <ol className="space-y-1">
            {resultado.eventos.map((e, i) => (
              <Linha key={i} evento={e} inicio={inicio} fuso={p.fuso} />
            ))}
          </ol>
        )}
      </div>

      <footer className="border-t px-4 py-2">
        <p className="text-[11px] leading-relaxed text-[var(--color-tinta-3)]">
          Relógio virtual no fuso do lead ({p.fuso}). As esperas são calculadas pelas mesmas regras
          que valem em produção, e nada é enviado — o simulador não conhece fornecedor nenhum.
        </p>
      </footer>
    </section>
  )
}

/** No relógio do lead: "24 horas" pode vencer dois dias depois por causa da
 *  janela de contato, e mostrar UTC esconderia exatamente isso. */
function formatarLocal(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

const ROTULO_TIPO: Record<EventoSimulado['tipo'], string> = {
  contato: 'contato',
  espera: 'espera',
  bloqueio: 'bloqueado',
  acao: 'ação',
  resposta: 'resposta',
  encerramento: 'fim',
}

function Linha({
  evento,
  inicio,
  fuso,
}: {
  evento: EventoSimulado
  inicio: Date | undefined
  fuso: string
}) {
  // Tempo relativo ao início: "às 14:00 de 11/03" diz menos que "+1d 2h" quando
  // o que se quer conferir é a cadência.
  const delta = inicio ? evento.instante.getTime() - inicio.getTime() : 0
  const min = Math.round(delta / 60000)
  const rel =
    min < 1
      ? 'início'
      : min < 60
        ? `+${min}min`
        : min < 1440
          ? `+${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ''}`
          : `+${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`

  return (
    <li className="flex items-start gap-2.5 text-[13px]">
      <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] text-[var(--color-tinta-3)]">
        {rel}
      </span>
      <span className="pt-1">
        <Ponto cor={evento.canal ? CORES[evento.canal]! : 'var(--color-tinta-3)'} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'font-medium',
            evento.tipo === 'bloqueio' && 'text-[var(--color-alerta)]',
            evento.tipo === 'resposta' && 'text-[var(--color-ok)]',
          )}
        >
          {evento.rotulo}
        </span>
        <span className="ml-2 text-[var(--color-tinta-3)]">{ROTULO_TIPO[evento.tipo]}</span>
        {evento.detalhe && (
          <span className="ml-2 text-xs text-[var(--color-tinta-2)]">{evento.detalhe}</span>
        )}
        {evento.ate && (
          <span className="ml-2 text-xs text-[var(--color-tinta-3)]">
            retoma {formatarLocal(evento.ate, fuso)}
          </span>
        )}
      </span>
    </li>
  )
}
