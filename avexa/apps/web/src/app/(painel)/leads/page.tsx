import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarCheck } from 'lucide-react'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import {
  clientePadrao,
  frentesEmSeco,
  listarClientes,
  listarLeads,
  resumoDeLeads,
  type LeadNaLista,
} from '@/lib/dados'
import { periodoValido, textoParaCursor } from '@/lib/resumo'
import { ResumoLeads } from '@/componentes/resumo-leads'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** `sem_destino` é vermelho igual a `falhou`: para quem espera o lead, "o fluxo
 *  pedia um destino que não existe" e "o destino recusou" dão no mesmo. */
const TOM_ENTREGA: Record<string, 'ok' | 'alerta' | 'neutro'> = {
  entregue: 'ok',
  falhou: 'alerta',
  sem_destino: 'alerta',
  seco: 'neutro',
}

const emAndamento = (estado: string | null) => estado === 'aguardando' || estado === 'executando'

/** Lead que valia a pena, fluxo terminado, e nenhuma entrega sequer tentada.
 *  Costuma ser fluxo publicado sem etapa de saída — e ninguém descobre isso
 *  olhando o fluxo, só olhando o lead que não chegou. */
const qualificadoSemSaida = (l: LeadNaLista) =>
  l.entregas.length === 0 && (l.score ?? 0) >= 60 && l.estado === 'concluida'

/** Lista de leads.
 *
 *  É a tela inteira do papel `cliente`, e para ele é somente leitura: os
 *  próprios leads, score, resumo e o que aconteceu em cada tentativa. O escopo é
 *  aplicado na consulta, não aqui — mudar o `?cliente=` na URL não leva a lugar
 *  nenhum. */
export default async function PaginaLeads({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; dias?: string; antes?: string; depois?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verLeads) redirect('/')

  const q = await searchParams
  const t = dicionarioDe(s.idioma)

  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente.</p>
  const seco = await frentesEmSeco(cli.id)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente.</p>

  const periodo = periodoValido(q.dias)
  // Cursor inválido na URL vira "sem cursor", ou seja, primeira página. Cair na
  // primeira página é melhor do que derrubar a tela com data inválida.
  const depois = textoParaCursor(q.depois)
  const antes = textoParaCursor(q.antes)

  const [pagina, resumo] = await Promise.all([
    listarLeads(s, cli.id, { dias: periodo, depois, antes }),
    resumoDeLeads(s, cli.id, periodo),
  ])
  const leads = pagina.leads
  const detalhe = !s.permissoes.escopoCliente

  // Preserva o cliente escolhido, senão o operador que está olhando um cliente
  // específico volta para o primeiro da lista ao navegar.
  const base = s.permissoes.escopoCliente ? '/leads?' : `/leads?cliente=${cli.slug}&`
  // Trocar o período recomeça a paginação: um cursor de 90 dias atrás não tem
  // sentido numa janela de 7, e levaria a uma página vazia.
  const linkDoPeriodo = (dias: number) => `${base}dias=${dias}`
  const linkDaPagina = (sentido: 'antes' | 'depois', cursor: string) =>
    `${base}dias=${periodo}&${sentido}=${encodeURIComponent(cursor)}`

  // No fuso do cliente, não no do lead: quem lê esta tela é o time que vai
  // entrar na reunião.
  const horario = new Intl.DateTimeFormat(s.idioma === 'en' ? 'en-AU' : 'pt-BR', {
    timeZone: cli.fusoHorario,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  /** Nome curto do destino: a coluna é estreita e "google_sheets" não diz nada
   *  para quem lê. */
  const NOME_DESTINO: Record<string, string> = {
    hubspot: 'CRM',
    hubspot_reuniao: 'Reunião no CRM',
    email_time: 'E-mail do time',
    google_sheets: 'Planilha',
    webhook: 'Webhook',
    webhook_saida: 'Webhook (fluxo)',
  }

  const rotuloResultado = (estado: string | null, motivo: string | null) => {
    if (emAndamento(estado)) return 'em andamento'
    if (motivo === 'lead respondeu') return 'respondeu'
    if (motivo === 'suprimido') return 'pediu para parar'
    if (motivo === 'teto_de_tentativas') return 'sem resposta'
    return motivo ?? '—'
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t['leads.titulo']}</h1>
        {!s.permissoes.escopoCliente && clientes.length > 1 && (
          <nav className="flex flex-wrap gap-1">
            {clientes.map((c) => (
              <Link
                key={c.id}
                href={`/leads?cliente=${c.slug}` as '/leads'}
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
        {seco.secas > 0 && (
          <Selo tom="alerta">
            {seco.total > 1 ? `modo seco em ${seco.secas} de ${seco.total}` : 'modo seco'}
          </Selo>
        )}
      </div>

      {resumo && <ResumoLeads resumo={resumo} periodo={periodo} href={linkDoPeriodo} />}

      {leads.length === 0 ? (
        <Cartao>
          {/* Cursor velho aponta para uma faixa que já não existe — mudou o
              período, ou os leads saíram pela retenção. Sem esta saída, a
              página fica sem lista e sem setas: um beco. */}
          {depois || antes ? (
            <p className="text-sm text-[var(--color-tinta-3)]">
              Nada nesta página.{' '}
              <Link href={linkDoPeriodo(periodo) as '/leads'} className="underline">
                Voltar ao início da lista
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-[var(--color-tinta-3)]">
              Nenhum lead nos últimos {periodo} dias.
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-tinta-3)]">
            Os leads chegam pela URL de webhook que o cliente colou na saída do formulário dele.
          </p>
        </Cartao>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-cartao)] border">
          <table className="w-full text-[13px]">
            <thead className="bg-[var(--color-superficie)] text-left text-xs text-[var(--color-tinta-3)]">
              <tr>
                <th className="p-3 font-medium">Lead</th>
                <th className="p-3 font-medium">{t['leads.score']}</th>
                <th className="p-3 font-medium">Contatos</th>
                <th className="p-3 font-medium">{t['leads.resultado']}</th>
                <th className="p-3 font-medium">{t['leads.entrega']}</th>
                <th className="p-3 font-medium">{t['leads.recebido']}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((l) => (
                <tr key={l.id} className="bg-[var(--color-superficie)] align-top">
                  <td className="p-3">
                    <span className="block font-medium">{l.nome ?? '—'}</span>
                    <span className="block text-xs text-[var(--color-tinta-3)]">
                      {l.telefone ?? l.email ?? '—'}
                    </span>
                    {l.resumo && (
                      <span className="mt-1 block max-w-sm text-xs leading-relaxed text-[var(--color-tinta-2)]">
                        {l.resumo}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {l.score === null ? (
                      // Score nulo não é zero: é "o modelo não conseguiu avaliar".
                      // Mostrar 0 mandaria o lead para o lixo por engano.
                      <span className="text-[var(--color-tinta-3)]">não avaliado</span>
                    ) : (
                      <Selo tom={l.score >= 60 ? 'ok' : 'neutro'}>{l.score}</Selo>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="flex items-center gap-1.5">
                      <Ponto cor={CORES.email!} />
                      {l.contatos}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--color-tinta-2)]">
                    {/* A reunião vem primeiro porque é o melhor resultado que
                        este produto pode dar. "Em andamento" ao lado de uma
                        reunião marcada é a informação menos importante das
                        duas. */}
                    {l.reuniao?.status === 'marcada' && l.reuniao.inicio && (
                      <span className="mb-1 block">
                        <Selo tom="ok">
                          <CalendarCheck size={11} aria-hidden className="mr-1" />
                          {t['leads.reuniao.marcada']} {horario.format(l.reuniao.inicio)}
                        </Selo>
                        {l.reuniao.responsavel && (
                          <span className="mt-0.5 block text-xs text-[var(--color-tinta-3)]">
                            com {l.reuniao.responsavel}
                          </span>
                        )}
                      </span>
                    )}
                    {l.reuniao?.status === 'oferecida' && (
                      <span className="mb-1 block">
                        <Selo>{t['leads.reuniao.linkEnviado']}</Selo>
                        <span className="mt-0.5 block text-xs text-[var(--color-tinta-3)]">
                          {t['leads.reuniao.semHorario']}
                        </span>
                      </span>
                    )}
                    {l.reuniao?.status === 'cancelada' && (
                      <span className="mb-1 block">
                        <Selo tom="alerta">{t['leads.reuniao.cancelada']}</Selo>
                        {l.reuniao.motivoCancelamento && (
                          <span className="mt-0.5 block max-w-[16rem] text-xs leading-snug text-[var(--color-tinta-3)]">
                            {l.reuniao.motivoCancelamento}
                          </span>
                        )}
                      </span>
                    )}
                    <span className={l.reuniao ? 'text-xs text-[var(--color-tinta-3)]' : ''}>
                      {rotuloResultado(l.estado, l.motivo)}
                    </span>
                  </td>
                  <td className="p-3">
                    {l.entregas.length === 0 ? (
                      // Vazio não é falha: o fluxo pode não ter chegado à etapa
                      // de saída ainda. Dizer "não entregue" aqui seria alarme
                      // falso em todo lead que acabou de entrar.
                      emAndamento(l.estado) ? (
                        <span className="text-xs text-[var(--color-tinta-3)]">
                          {t['leads.entrega.noFluxo']}
                        </span>
                      ) : qualificadoSemSaida(l) ? (
                        // Lead bom, fluxo encerrado, e nenhuma etapa de saída
                        // registrou nada. Não é erro de entrega — é fluxo sem
                        // destino, que é pior, porque não gera nem falha.
                        <Selo tom="alerta">{t['leads.entrega.semSaida']}</Selo>
                      ) : (
                        <span className="text-xs text-[var(--color-tinta-3)]">—</span>
                      )
                    ) : (
                      <ul className="space-y-1">
                        {l.entregas.map((e) => (
                          <li key={e.destino}>
                            <Selo tom={TOM_ENTREGA[e.estado] ?? 'neutro'}>
                              {NOME_DESTINO[e.destino] ?? e.destino}
                              {e.estado === 'seco' ? ' · teste' : ''}
                            </Selo>
                            {(e.estado === 'falhou' || e.estado === 'sem_destino') && (
                              <span className="mt-0.5 block max-w-[22rem] text-xs leading-snug text-[var(--color-alerta)]">
                                {t['leads.entrega.naoChegou']}
                                {/* O texto cru do erro é do operador: para o
                                    cliente final é ruído, e pode trazer junto
                                    resposta de fornecedor que não é dele. */}
                                {detalhe && e.erro ? `: ${e.erro}` : ''}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="p-3 text-xs text-[var(--color-tinta-3)]">
                    {l.criadoEm.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(pagina.anterior || pagina.proxima) && (
        <nav className="mt-4 flex flex-wrap items-center gap-2">
          {pagina.anterior ? (
            <Link
              href={linkDaPagina('antes', pagina.anterior) as '/leads'}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
            >
              ← Mais recentes
            </Link>
          ) : (
            // O botão fica visível e apagado em vez de sumir: um botão que
            // aparece e desaparece move a página debaixo do cursor.
            <span className="rounded-lg border px-3 py-1.5 text-[13px] opacity-40">
              ← Mais recentes
            </span>
          )}
          {pagina.proxima ? (
            <Link
              href={linkDaPagina('depois', pagina.proxima) as '/leads'}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
            >
              Mais antigos →
            </Link>
          ) : (
            <span className="rounded-lg border px-3 py-1.5 text-[13px] opacity-40">
              Mais antigos →
            </span>
          )}
          {resumo && (
            <span className="text-xs text-[var(--color-tinta-3)]">
              {leads.length} de {resumo.total} leads no período
            </span>
          )}
        </nav>
      )}
    </div>
  )
}
