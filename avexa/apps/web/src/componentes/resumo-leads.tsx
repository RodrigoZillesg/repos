import Link from 'next/link'
import { CalendarCheck, Inbox, Send, Star } from 'lucide-react'
import type { ResumoDeLeads } from '@/lib/dados'
import { PERIODOS, variacao, type NumeroDoResumo, type Periodo } from '@/lib/resumo'

/** A faixa de números no topo da lista de leads.
 *
 *  Quatro números, não um gráfico: é um punhado de valores de manchete, e um
 *  gráfico de barras com quatro barras de grandezas diferentes seria decoração.
 *
 *  A ordem é a do funil — chegou, valia a pena, virou conversa, chegou ao time
 *  — porque é assim que a pergunta é feita: "o que aconteceu com os meus
 *  leads?". A resposta se lê da esquerda para a direita. */

interface Props {
  resumo: ResumoDeLeads
  periodo: Periodo
  /** Para os links de período preservarem o cliente escolhido. */
  href: (dias: Periodo) => string
}

const ROTULO_PERIODO: Record<Periodo, string> = {
  7: '7 dias',
  30: '30 dias',
  90: '90 dias',
}

/** A variação contra o período anterior de igual duração.
 *
 *  Em todos os quatro números, subir é bom — então a cor pode seguir o sinal
 *  direto, sem exceção por métrica. Mas cor sozinha não carrega a informação:
 *  vem sempre com o sinal escrito ao lado. */
function Variacao({ n, dias }: { n: NumeroDoResumo; dias: number }) {
  const v = variacao(n)
  if (v.tipo === 'nenhuma') return null
  if (v.tipo === 'igual') {
    return (
      <span className="text-xs text-[var(--color-tinta-3)]">igual aos {dias} dias anteriores</span>
    )
  }
  return (
    <span
      className="text-xs"
      style={{ color: v.subiu ? 'var(--color-ok)' : 'var(--color-alerta)' }}
    >
      {v.texto} vs. {dias} dias antes
    </span>
  )
}

function Bloco({
  rotulo,
  n,
  dias,
  icone,
  ajuda,
}: {
  rotulo: string
  n: NumeroDoResumo
  dias: number
  icone: React.ReactNode
  ajuda: string
}) {
  return (
    <div className="rounded-[var(--radius-cartao)] border bg-[var(--color-superficie)] p-4">
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-tinta-2)]">
        <span className="text-[var(--color-tinta-3)]">{icone}</span>
        {rotulo}
      </span>
      {/* Figuras proporcionais, não tabulares: `tabular-nums` daria a cada
          dígito a largura de um zero, e num número grande isso fica frouxo. */}
      <span className="mt-1.5 block text-3xl font-semibold leading-none">{n.valor}</span>
      <span className="mt-1.5 block">
        <Variacao n={n} dias={dias} />
      </span>
      <span className="mt-1.5 block text-xs leading-snug text-[var(--color-tinta-3)]">{ajuda}</span>
    </div>
  )
}

export function ResumoLeads({ resumo, periodo, href }: Props) {
  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODOS.map((p) => (
          <Link
            key={p}
            href={href(p) as '/leads'}
            className={`rounded-lg border px-2.5 py-1 text-[13px] ${
              p === periodo
                ? 'border-[var(--color-acento)] text-[var(--color-acento)]'
                : 'text-[var(--color-tinta-2)]'
            }`}
          >
            {ROTULO_PERIODO[p]}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Bloco
          rotulo="Leads recebidos"
          n={resumo.recebidos}
          dias={resumo.dias}
          icone={<Inbox size={13} aria-hidden />}
          ajuda="Chegaram pelo formulário ou pela fonte ligada ao fluxo."
        />
        <Bloco
          rotulo="Qualificados"
          n={resumo.qualificados}
          dias={resumo.dias}
          icone={<Star size={13} aria-hidden />}
          ajuda="Passaram do corte de score depois da conversa."
        />
        <Bloco
          rotulo="Reuniões marcadas"
          n={resumo.reunioes}
          dias={resumo.dias}
          icone={<CalendarCheck size={13} aria-hidden />}
          // Contadas pela data em que foram marcadas: o trabalho foi feito
          // neste período mesmo que a conversa seja no mês que vem.
          ajuda="Com hora confirmada na agenda. Marcadas neste período."
        />
        <Bloco
          rotulo="Entregues ao time"
          n={resumo.entregues}
          dias={resumo.dias}
          icone={<Send size={13} aria-hidden />}
          ajuda="Chegaram ao CRM, à planilha ou ao e-mail do time."
        />
      </div>
    </div>
  )
}
