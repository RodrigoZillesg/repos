import { redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, integracao } from '@avexa/db'
import { googleConfigurado } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { clientePadrao, listarClientes } from '@/lib/dados'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import { IntegracaoGoogle, type EstadoIntegracao } from '@/componentes/integracao-google'
import { desligar, salvarAgendas, salvarPlanilha } from './acoes'

export const dynamic = 'force-dynamic'

const MENSAGEM: Record<string, string> = {
  'sem-permissao': 'Só o administrador conecta contas de cliente.',
  'pedido-invalido': 'Pedido inválido.',
  'google-nao-configurado': 'Este ambiente não tem as credenciais do Google.',
  'state-invalido': 'O retorno do Google não conferiu. Comece de novo.',
  'sem-codigo': 'O Google não devolveu um código de autorização.',
  access_denied: 'O consentimento foi recusado na tela do Google.',
}

export default async function PaginaIntegracoes({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; erro?: string; conectado?: string }>
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

  const estado = (tipo: EstadoIntegracao['tipo']): EstadoIntegracao => {
    const linha = linhas.find((l) => l.tipo === tipo && l.ativo)
    const cfg = (linha?.config ?? {}) as Record<string, unknown>
    return {
      clienteId: cli.id,
      tipo,
      conectada: Boolean(linha),
      conta: typeof cfg.conta === 'string' ? cfg.conta : undefined,
      calendarios: Array.isArray(cfg.calendarios) ? (cfg.calendarios as string[]) : undefined,
      planilhaId: typeof cfg.planilhaId === 'string' ? cfg.planilhaId : undefined,
      aba: typeof cfg.aba === 'string' ? cfg.aba : undefined,
    }
  }

  const configurado = googleConfigurado()

  return (
    <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Integrações</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        Cada cliente conecta a própria conta Google. A Avexa não é dona da agenda nem da planilha de
        ninguém: guardamos apenas a autorização, cifrada, e o cliente pode revogá-la a qualquer
        momento pela própria conta.
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
            <Selo tom="ok">conectado</Selo> Falta escolher o destino abaixo para a integração
            funcionar.
          </p>
        </Cartao>
      )}

      <div className="mt-5 space-y-4">
        <IntegracaoGoogle
          estado={estado('google_calendar')}
          podeAdministrar={s.permissoes.administrar}
          googleConfigurado={configurado}
          aoDesligar={desligar}
          aoSalvarAgendas={salvarAgendas}
          aoSalvarPlanilha={salvarPlanilha}
        />
        <IntegracaoGoogle
          estado={estado('google_sheets')}
          podeAdministrar={s.permissoes.administrar}
          googleConfigurado={configurado}
          aoDesligar={desligar}
          aoSalvarAgendas={salvarAgendas}
          aoSalvarPlanilha={salvarPlanilha}
        />
      </div>
    </div>
  )
}
