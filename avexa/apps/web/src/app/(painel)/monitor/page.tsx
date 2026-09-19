import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import { canaisDoCliente, clientePadrao, listarClientes, resumoMonitor } from '@/lib/dados'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import {
  BarrasBloqueio,
  SerieCanal,
  TabelaCanais,
  TabelaSerie,
  Tile,
} from '@/componentes/monitor'

export const dynamic = 'force-dynamic'

/** Monitor de qualidade.
 *
 *  Não responde "quantos leads" — responde "está saindo contato?", "o que está
 *  barrando?" e "tem lead parado?". Este produto falha calado: um fluxo que pula
 *  WhatsApp em todo lead porque o template não foi aprovado não gera erro
 *  nenhum, só silêncio, e é justamente isso que esta tela existe para quebrar. */
export default async function PaginaMonitor({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verFluxos) redirect('/')

  const q = await searchParams
  const t = dicionarioDe(s.idioma)

  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente.</p>

  const m = await resumoMonitor(s, cli.id)
  const ativos = await canaisDoCliente(cli.id)
  const contratados = Object.entries(ativos)
    .filter(([, v]) => v)
    .map(([k]) => k)
  const taxa = m.kpis.contatos > 0 ? Math.round((m.kpis.respostas / m.kpis.contatos) * 100) : null
  const semContato = m.kpis.contatos === 0 && m.kpis.leads > 0

  const canais = ['ligacao', 'whatsapp', 'sms', 'email'] as const

  return (
    <div className="mx-auto w-full max-w-5xl p-6 lg:p-8">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Monitor</h1>
        <span className="text-xs text-[var(--color-tinta-3)]">últimos {m.dias} dias</span>
        {cli.dryRun && <Selo tom="alerta">modo seco</Selo>}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {clientes.length > 1 && (
          <nav className="flex flex-wrap gap-1">
            {clientes.map((c) => (
              <Link
                key={c.id}
                href={`/monitor?cliente=${c.slug}` as '/monitor'}
                className={
                  c.id === cli.id
                    ? 'rounded-lg bg-[var(--color-acento-suave)] px-2.5 py-1 text-[13px] font-medium text-[var(--color-acento)]'
                    : 'rounded-lg px-2.5 py-1 text-[13px] text-[var(--color-tinta-2)] hover:bg-[var(--color-acento-suave)]'
                }
              >
                {c.nome}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* Um lead entrando e nenhum contato saindo é o silêncio que este produto
          produz quando algo está errado. Vai em destaque, não numa tabela. */}
      {semContato && (
        <Cartao className="mb-4 border-[var(--color-alerta)]">
          <p className="text-[13px] font-medium text-[var(--color-alerta)]">
            {m.kpis.leads} lead(s) entraram e nenhum contato saiu.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-tinta-2)]">
            Olhe os motivos abaixo. Os mais comuns são template ainda não aprovado pela Meta, canal
            não contratado e lead sem endereço no canal do fluxo.
          </p>
        </Cartao>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile rotulo="Leads recebidos" valor={String(m.kpis.leads)} nota={`em ${m.dias} dias`} />
        <Tile
          rotulo="Contatos que saíram"
          valor={String(m.kpis.contatos)}
          {...(m.kpis.contatos === 0 ? { tom: 'alerta' as const } : {})}
        />
        <Tile
          rotulo="Taxa de resposta"
          valor={taxa === null ? '—' : `${taxa}%`}
          nota={`${m.kpis.respostas} resposta(s)`}
        />
        <Tile
          rotulo="Na supressão"
          valor={String(m.kpis.suprimidosTotal)}
          nota="global, todos os clientes"
        />
      </div>

      <section className="mt-7">
        <h2 className="mb-1 text-sm font-semibold">Contatos por dia</h2>
        <p className="mb-4 text-xs text-[var(--color-tinta-2)]">
          Um gráfico por canal, na mesma escala de dias. Um canal que some do desenho não está
          falhando em silêncio — está aqui.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {canais.map((c) => (
            <SerieCanal
              key={c}
              canal={c}
              pontos={m.serie.map((l) => ({ dia: l.dia, n: l[c] }))}
              contratado={contratados.includes(c)}
            />
          ))}
        </div>
        <TabelaSerie serie={m.serie} contratados={contratados} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Por canal</h2>
        <TabelaCanais dados={m.porCanal} contratados={contratados} />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-sm font-semibold">O que barrou um contato</h2>
          <p className="mb-3 text-xs text-[var(--color-tinta-2)]">
            Adiamentos não entram: adiar não é barrar, e o lead volta quando a janela abre.
          </p>
          <Cartao>
            <BarrasBloqueio dados={m.bloqueios} />
          </Cartao>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Leads esperando</h2>
          <p className="mb-3 text-xs text-[var(--color-tinta-2)]">
            Execuções em espera e quando cada uma retoma, no relógio do lead.
          </p>
          <Cartao className="p-0">
            {m.paradas.length === 0 ? (
              <p className="p-4 text-xs text-[var(--color-tinta-3)]">Ninguém em espera.</p>
            ) : (
              <ul className="divide-y">
                {m.paradas.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 p-3 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.lead}</span>
                      <span className="block text-xs text-[var(--color-tinta-3)]">{p.fluxo}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--color-tinta-2)]">
                      {p.retomarEm
                        ? new Intl.DateTimeFormat('pt-BR', {
                            timeZone: cli.fusoHorario,
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(p.retomarEm)
                        : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </section>
      </div>

      {m.falhas.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Falhas recentes de fornecedor</h2>
          <Cartao className="p-0">
            <ul className="divide-y">
              {m.falhas.map((f, i) => (
                <li key={i} className="p-3 text-[13px]">
                  <span className="flex flex-wrap items-center gap-2">
                    <Selo tom="alerta">{f.canal}</Selo>
                    <span className="text-xs text-[var(--color-tinta-3)]">{f.provedor ?? '—'}</span>
                    <span className="ml-auto text-xs tabular-nums text-[var(--color-tinta-3)]">
                      {f.quando?.toISOString().slice(0, 16).replace('T', ' ') ?? ''}
                    </span>
                  </span>
                  <span className="mt-1 block break-words text-xs text-[var(--color-tinta-2)]">
                    {f.erro}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        </section>
      )}
    </div>
  )
}
