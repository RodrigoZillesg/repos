import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import { clientePadrao, listarClientes, listarLeads, type LeadNaLista } from '@/lib/dados'
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
  searchParams: Promise<{ cliente?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verLeads) redirect('/')

  const q = await searchParams
  const t = dicionarioDe(s.idioma)

  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente.</p>

  const leads = await listarLeads(s, cli.id)
  const detalhe = !s.permissoes.escopoCliente

  /** Nome curto do destino: a coluna é estreita e "google_sheets" não diz nada
   *  para quem lê. */
  const NOME_DESTINO: Record<string, string> = {
    hubspot: 'CRM',
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
        {cli.dryRun && <Selo tom="alerta">modo seco</Selo>}
      </div>

      {leads.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[var(--color-tinta-3)]">{t['leads.vazio']}</p>
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
                    {rotuloResultado(l.estado, l.motivo)}
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
    </div>
  )
}
