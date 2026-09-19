'use client'

import { useId, useState } from 'react'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { Botao } from '@/componentes/ui/botao'
import { CORES, cn } from '@/lib/utils'
import type { ResumoMonitor } from '@/lib/dados'

/** Peças do monitor.
 *
 *  Cada pequena série tem uma série só, então não leva legenda: o título já diz
 *  o que está plotado. A identidade de canal vem do ponto colorido ao lado do
 *  nome, nunca de colorir o texto. E toda série tem tabela — é o alívio exigido
 *  pelo par verde↔laranja, que fica na faixa de separação mínima em
 *  deuteranopia. */

const NOME_CANAL: Record<string, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'E-mail',
}

export function Tile({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string
  valor: string
  nota?: string
  tom?: 'neutro' | 'alerta'
}) {
  return (
    <Cartao className="min-w-0">
      <p className="text-xs text-[var(--color-tinta-3)]">{rotulo}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tom === 'alerta' && 'text-[var(--color-alerta)]',
        )}
      >
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-xs text-[var(--color-tinta-3)]">{nota}</p>}
    </Cartao>
  )
}

const ALTURA = 56
const LARGURA = 280
const GAP = 2

/** Uma pequena série por canal: colunas a partir de uma linha de base única,
 *  topo arredondado em 4px, base reta, 2px de respiro entre vizinhas. */
export function SerieCanal({
  canal,
  pontos,
  contratado,
}: {
  canal: string
  pontos: Array<{ dia: string; n: number }>
  contratado: boolean
}) {
  const [sobre, setSobre] = useState<number | null>(null)
  const idTitulo = useId()
  const cor = CORES[canal]!
  const max = Math.max(1, ...pontos.map((p) => p.n))
  const total = pontos.reduce((a, p) => a + p.n, 0)
  const slot = LARGURA / pontos.length
  const larguraBarra = Math.min(24, slot - GAP)

  // Canal vazio porque não foi contratado é ruído; canal contratado e vazio é
  // alarme. Um gráfico em branco não distingue os dois, então o texto distingue.
  if (!contratado) {
    return (
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-[var(--color-borda)]" />
          <h3 className="text-[13px] font-medium text-[var(--color-tinta-3)]">
            {NOME_CANAL[canal] ?? canal}
          </h3>
        </div>
        <p className="rounded-lg border border-dashed px-3 py-4 text-xs text-[var(--color-tinta-3)]">
          Não contratado por este cliente.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <Ponto cor={cor} />
        <h3 className="text-[13px] font-medium" id={idTitulo}>
          {NOME_CANAL[canal] ?? canal}
        </h3>
        <span
          className={cn(
            'ml-auto text-xs tabular-nums',
            total === 0 ? 'text-[var(--color-alerta)]' : 'text-[var(--color-tinta-3)]',
          )}
        >
          {total === 0 ? 'nenhum contato saiu' : `${total} no período`}
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA + 14}`}
          className="w-full"
          role="img"
          aria-labelledby={idTitulo}
          onMouseLeave={() => setSobre(null)}
        >
          {/* Linha de base: hairline, um passo fora da superfície, recessiva. */}
          <line
            x1="0"
            y1={ALTURA}
            x2={LARGURA}
            y2={ALTURA}
            stroke="var(--color-borda)"
            strokeWidth="1"
          />
          {pontos.map((p, i) => {
            const h = p.n === 0 ? 0 : Math.max(3, (p.n / max) * (ALTURA - 10))
            const x = i * slot + (slot - larguraBarra) / 2
            return (
              <g key={p.dia}>
                {/* Alvo de toque maior que a marca. */}
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={ALTURA + 14}
                  fill="transparent"
                  onMouseEnter={() => setSobre(i)}
                />
                {h > 0 && (
                  <rect
                    x={x}
                    y={ALTURA - h}
                    width={larguraBarra}
                    height={h}
                    rx="4"
                    fill={cor}
                    opacity={sobre === null || sobre === i ? 1 : 0.35}
                  />
                )}
                {/* O retângulo arredondado arredonda os quatro cantos; este
                    quadrado devolve a base reta sobre a linha. */}
                {h > 4 && (
                  <rect x={x} y={ALTURA - 4} width={larguraBarra} height={4} fill={cor} opacity={sobre === null || sobre === i ? 1 : 0.35} />
                )}
              </g>
            )
          })}
          {/* Rótulo direto só no pico: um número por coluna seria ilegível. */}
          {max > 0 && (
            <text
              x={pontos.findIndex((p) => p.n === max) * slot + slot / 2}
              y={ALTURA - (max / max) * (ALTURA - 10) - 3}
              textAnchor="middle"
              className="fill-[var(--color-tinta-3)] text-[9px] tabular-nums"
            >
              {max}
            </text>
          )}
        </svg>

        {sobre !== null && pontos[sobre] && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-lg border bg-[var(--color-superficie)] px-2 py-1 text-xs shadow-sm"
            style={{ left: `${((sobre + 0.5) / pontos.length) * 100}%`, transform: 'translate(-50%, -100%)' }}
          >
            <span className="font-medium tabular-nums">{pontos[sobre].n}</span>{' '}
            <span className="text-[var(--color-tinta-3)]">
              em {pontos[sobre].dia.slice(8)}/{pontos[sobre].dia.slice(5, 7)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Motivos de bloqueio: comparação de magnitude entre categorias sem ordem
 *  natural, então uma cor só para todas as barras. */
export function BarrasBloqueio({ dados }: { dados: ResumoMonitor['bloqueios'] }) {
  const max = Math.max(1, ...dados.map((d) => d.n))

  const LEGIVEL: Record<string, string> = {
    suprimido: 'Pediu para parar',
    ja_respondeu: 'Já havia respondido',
    teto_de_tentativas: 'Bateu o teto de tentativas',
    canal_desligado: 'Canal não contratado',
    template_nao_aprovado: 'Template não aprovado',
    sem_destinatario: 'Lead sem endereço no canal',
    fora_da_janela: 'Fora da janela de contato',
    intervalo_minimo: 'Intervalo mínimo entre contatos',
  }

  if (dados.length === 0) {
    return <p className="text-xs text-[var(--color-tinta-3)]">Nada foi barrado no período.</p>
  }

  return (
    <ul className="space-y-2">
      {dados.map((d) => (
        <li key={d.motivo} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
          <span className="text-[13px]">{LEGIVEL[d.motivo] ?? d.motivo}</span>
          <span className="text-[13px] tabular-nums text-[var(--color-tinta-2)]">{d.n}</span>
          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-borda)]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(d.n / max) * 100}%`, background: 'var(--color-acento)' }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Tabela da mesma série. Não é um extra: é o alívio que a paleta exige, e
 *  também a resposta para quem prefere o número ao desenho. */
export function TabelaSerie({
  serie,
  contratados,
}: {
  serie: ResumoMonitor['serie']
  contratados: readonly string[]
}) {
  const [aberta, setAberta] = useState(false)
  const canais = (['ligacao', 'whatsapp', 'sms', 'email'] as const).filter((c) =>
    contratados.includes(c),
  )

  return (
    <div className="mt-3">
      <Botao variante="fantasma" tamanho="pequeno" onClick={() => setAberta((v) => !v)}>
        {aberta ? 'Esconder a tabela' : 'Ver como tabela'}
      </Botao>
      {aberta && (
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-fundo)] text-left text-[var(--color-tinta-3)]">
              <tr>
                <th className="p-2 font-medium">Dia</th>
                {canais.map((c) => (
                  <th key={c} className="p-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Ponto cor={CORES[c]!} />
                      {NOME_CANAL[c]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {serie.map((l) => (
                <tr key={l.dia}>
                  <td className="p-2 tabular-nums text-[var(--color-tinta-3)]">
                    {l.dia.slice(8)}/{l.dia.slice(5, 7)}
                  </td>
                  {canais.map((c) => (
                    <td key={c} className="p-2 tabular-nums">
                      {l[c] || <span className="text-[var(--color-tinta-3)]">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Taxa de resposta por canal: uma razão contra um limite, então medidor —
 *  não um gráfico de pizza de duas fatias. */
export function TabelaCanais({
  dados,
  contratados,
}: {
  dados: ResumoMonitor['porCanal']
  contratados: readonly string[]
}) {
  const linhas = dados.filter((c) => contratados.includes(c.canal))
  return (
    <div className="overflow-x-auto rounded-[var(--radius-cartao)] border">
      <table className="w-full text-[13px]">
        <thead className="bg-[var(--color-superficie)] text-left text-xs text-[var(--color-tinta-3)]">
          <tr>
            <th className="p-3 font-medium">Canal</th>
            <th className="p-3 font-medium">Saíram</th>
            <th className="p-3 font-medium">Entregues</th>
            <th className="p-3 font-medium">Falharam</th>
            <th className="p-3 font-medium">Responderam</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {linhas.map((c) => {
            const taxa = c.tentativas > 0 ? c.respondidas / c.tentativas : 0
            return (
              <tr key={c.canal} className="bg-[var(--color-superficie)]">
                <td className="p-3">
                  <span className="flex items-center gap-2">
                    <Ponto cor={CORES[c.canal]!} />
                    {NOME_CANAL[c.canal] ?? c.canal}
                  </span>
                </td>
                <td className="p-3 tabular-nums">{c.tentativas}</td>
                <td className="p-3 tabular-nums">{c.entregues}</td>
                <td className="p-3 tabular-nums">
                  {c.falhas > 0 ? (
                    <Selo tom="alerta">{c.falhas}</Selo>
                  ) : (
                    <span className="text-[var(--color-tinta-3)]">0</span>
                  )}
                </td>
                <td className="p-3">
                  <span className="flex items-center gap-2">
                    <span className="w-10 tabular-nums">
                      {c.tentativas > 0 ? `${Math.round(taxa * 100)}%` : '—'}
                    </span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-borda)]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${taxa * 100}%`, background: CORES[c.canal] }}
                      />
                    </span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
