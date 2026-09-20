import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sessaoAtual, encerrarSessao } from '@/lib/auth'
import { criarT } from '@/i18n/dicionario'
import { Botao } from '@/componentes/ui/botao'
import { Selo } from '@/componentes/ui/cartao'
import { AlternarTema } from '@/componentes/tema'

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')

  const t = criarT(s.idioma)

  // A navegação mostra apenas o que o papel pode abrir. Não é segurança — a
  // verdade está nas consultas — mas uma aba que leva a "sem permissão" é uma
  // aba que não devia existir.
  const abas = [
    { href: '/ativar', rotulo: t('nav.ativar'), visivel: s.permissoes.verClientes },
    { href: '/fluxos', rotulo: t('nav.fluxos'), visivel: s.permissoes.verFluxos },
    { href: '/templates', rotulo: t('nav.templates'), visivel: s.permissoes.templates.length > 0 },
    { href: '/leads', rotulo: t('nav.leads'), visivel: s.permissoes.verLeads },
    { href: '/monitor', rotulo: t('nav.monitor'), visivel: s.permissoes.verFluxos },
    { href: '/agentes', rotulo: t('nav.agentes'), visivel: s.permissoes.verFluxos },
    { href: '/integracoes', rotulo: t('nav.integracoes'), visivel: s.permissoes.verClientes },
    { href: '/configuracoes', rotulo: t('nav.configuracoes'), visivel: s.permissoes.verFluxos },
    { href: '/arquitetura', rotulo: t('nav.arquitetura'), visivel: s.permissoes.verFluxos },
  ].filter((a) => a.visivel)

  async function sair() {
    'use server'
    await encerrarSessao()
    redirect('/entrar')
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-[var(--color-superficie)] px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-white"
            style={{ background: 'var(--color-acento)' }}
          >
            A
          </span>
          <span className="text-sm">{t('app.nome')}</span>
        </Link>

        <nav className="ml-3 flex items-center gap-1 overflow-x-auto">
          {abas.map((a) => (
            <Link
              key={a.href}
              href={a.href as '/fluxos'}
              className="rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--color-tinta-2)] transition-colors hover:bg-[var(--color-acento-suave)] hover:text-[var(--color-tinta)]"
            >
              {a.rotulo}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Selo>{s.nome}</Selo>
          <AlternarTema />
          <form action={sair}>
            <Botao variante="fantasma" tamanho="pequeno" type="submit">
              {t('nav.sair')}
            </Botao>
          </form>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
