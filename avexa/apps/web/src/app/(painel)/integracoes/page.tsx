import { redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, integracao } from '@avexa/db'
import { calendlyConfigurado, googleConfigurado, hubspotConfigurado } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { clientePadrao, listarClientes } from '@/lib/dados'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import { Integracoes, type EstadoCliente } from '@/componentes/integracoes'
import {
  buscarAgendas,
  buscarTiposDeEvento,
  desligar,
  escolherProvedorAgenda,
  salvarAgendas,
  salvarEmailTime,
  salvarPlanilha,
  salvarStatusHubspot,
  salvarTipoDeEvento,
  salvarWebhook,
  testarWebhook,
} from './acoes'

export const dynamic = 'force-dynamic'

const MENSAGEM: Record<string, string> = {
  'sem-permissao': 'Só o administrador conecta contas de cliente.',
  'pedido-invalido': 'Pedido inválido.',
  'fornecedor-nao-configurado': 'Este ambiente não tem as credenciais desse fornecedor.',
  'state-invalido': 'O retorno do fornecedor não conferiu. Comece de novo.',
  'sem-codigo': 'O fornecedor não devolveu um código de autorização.',
  access_denied: 'O consentimento foi recusado na tela do fornecedor.',
}

export default async function PaginaIntegracoes({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; erro?: string; conectado?: string; aviso?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verClientes) redirect('/')

  const q = await searchParams
  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente.</p>

  const d = db()
  const linhas = await d.select().from(integracao).where(eq(integracao.clienteId, cli.id))

  const cfg = (tipo: string): Record<string, unknown> => {
    const linha = linhas.find((l) => l.tipo === tipo && l.ativo)
    return linha ? ((linha.config ?? {}) as Record<string, unknown>) : {}
  }
  const conectada = (tipo: string) => linhas.some((l) => l.tipo === tipo && l.ativo)

  const estado: EstadoCliente = {
    clienteId: cli.id,
    provedorEscolhido: (cli.provedorAgenda as EstadoCliente['provedorEscolhido']) ?? null,
    googleConfigurado: googleConfigurado(),
    calendlyConfigurado: calendlyConfigurado(),
    calendar: {
      conectada: conectada('google_calendar'),
      calendarios: (cfg('google_calendar').calendarios as string[] | undefined) ?? [],
      // Nomes guardados na última escolha, para a tela abrir legível sem ir ao
      // Google a cada visita.
      nomes: (cfg('google_calendar').calendariosNomes as Record<string, string> | undefined) ?? {},
      rodizio: cfg('google_calendar').rodizio !== false,
    },
    calendly: {
      conectada: conectada('calendly'),
      tipoDeEvento: (cfg('calendly').tipoDeEvento as string | undefined) ?? null,
      tipoDeEventoNome: (cfg('calendly').tipoDeEventoNome as string | undefined) ?? null,
      tipoDeEventoDuracao: (cfg('calendly').tipoDeEventoDuracao as number | undefined) ?? null,
    },
    sheets: {
      conectada: conectada('google_sheets'),
      planilhaId: (cfg('google_sheets').planilhaId as string | undefined) ?? null,
      aba: (cfg('google_sheets').aba as string | undefined) ?? null,
    },
    hubspotConfigurado: hubspotConfigurado(),
    hubspot: {
      conectada: conectada('hubspot'),
      conta: (cfg('hubspot').conta as string | undefined) ?? null,
      propriedadesOk: cfg('hubspot').propriedadesOk !== false,
      statusDisponiveis:
        (cfg('hubspot').statusDisponiveis as Array<{ valor: string; rotulo: string }> | undefined) ??
        [],
      statusQualificado: (cfg('hubspot').statusQualificado as string | undefined) ?? null,
      statusNaoQualificado: (cfg('hubspot').statusNaoQualificado as string | undefined) ?? null,
    },
    webhook: {
      url: (cfg('webhook').url as string | undefined) ?? null,
      // Só se existe, nunca o valor: o segredo não sai do servidor depois de
      // gravado, nem para a tela de quem o gerou.
      temSegredo: Boolean(linhas.find((l) => l.tipo === 'webhook' && l.ativo)?.segredo),
    },
    emailTime: { para: (cfg('email_time').para as string | undefined) ?? null },
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Integrações</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        Agenda, CRM e planilha são do cliente, e é neles que a Avexa trabalha. Não somos donos de
        nada disso: guardamos apenas a autorização, cifrada, e o cliente pode revogá-la a qualquer
        momento pela própria conta. Aqui também ficam os dois destinos que não dependem de conta
        nenhuma — o webhook do sistema dele e o e-mail do time.
      </p>

      {clientes.length > 1 && (
        <nav className="mt-4 flex flex-wrap gap-1">
          {clientes.map((c) => (
            <Link
              key={c.id}
              href={`/integracoes?cliente=${c.slug}` as '/integracoes'}
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

      {q.erro && (
        <Cartao className="mt-4 border-[var(--color-alerta)]">
          <p className="text-[13px] text-[var(--color-alerta)]">
            {MENSAGEM[q.erro] ?? decodeURIComponent(q.erro)}
          </p>
        </Cartao>
      )}
      {q.conectado && (
        <Cartao className="mt-4 border-[var(--color-ok)]">
          <p className="text-[13px]">
            <Selo tom="ok">conectado</Selo>{' '}
            {q.aviso
              ? decodeURIComponent(q.aviso)
              : 'Falta escolher o destino abaixo para a integração funcionar.'}
          </p>
        </Cartao>
      )}

      <div className="mt-5">
        <Integracoes
          estado={estado}
          podeAdministrar={s.permissoes.administrar}
          aoDesligar={desligar}
          aoSalvarAgendas={salvarAgendas}
          aoBuscarAgendas={buscarAgendas}
          aoSalvarPlanilha={salvarPlanilha}
          aoSalvarTipoDeEvento={salvarTipoDeEvento}
          aoBuscarTipos={buscarTiposDeEvento}
          aoEscolherProvedor={escolherProvedorAgenda}
          aoSalvarStatusHubspot={salvarStatusHubspot}
          aoSalvarWebhook={salvarWebhook}
          aoTestarWebhook={testarWebhook}
          aoSalvarEmailTime={salvarEmailTime}
        />
      </div>
    </div>
  )
}
