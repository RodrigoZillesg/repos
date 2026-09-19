import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import {
  canaisDoCliente,
  carregarFluxo,
  clientePadrao,
  listarClientes,
  listarFluxos,
  listarTemplates,
} from '@/lib/dados'
import { Construtor } from '@/componentes/construtor'
import { Selo } from '@/componentes/ui/cartao'
import { salvarFluxo } from './acoes'

export const dynamic = 'force-dynamic'

export default async function PaginaFluxos({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; fluxo?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verFluxos) redirect('/')

  const q = await searchParams
  const t = dicionarioDe(s.idioma)

  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) {
    return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente cadastrado.</p>
  }

  const fluxos = await listarFluxos(cli.id)
  const escolhido = fluxos.find((f) => f.id === q.fluxo) ?? fluxos[0]
  if (!escolhido) {
    return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Este cliente ainda não tem fluxos.</p>
  }

  const carregado = await carregarFluxo(escolhido.id)
  const canais = await canaisDoCliente(cli.id)
  const modelos = await listarTemplates(cli.id)

  const porCanal: Record<string, string[]> = {}
  for (const m of modelos) {
    // Só template aprovado entra na lista: oferecer um pendente seria oferecer
    // uma etapa que o motor vai pular na hora do envio.
    if (m.status === 'aprovado') (porCanal[m.canal] ??= []).push(m.nome)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs text-[var(--color-tinta-3)]">
          {t['comum.cliente']}
          <select
            name="cliente"
            defaultValue={cli.slug}
            className="h-7 rounded-lg border bg-[var(--color-superficie)] px-2 text-[13px] text-[var(--color-tinta)]"
            // Sem JS o form nativo ainda navega; com JS o Next intercepta.
          >
            {clientes.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>

        <nav className="flex items-center gap-1">
          {fluxos.map((f) => (
            <Link
              key={f.id}
              href={`/fluxos?cliente=${cli.slug}&fluxo=${f.id}` as '/fluxos'}
              className={
                f.id === escolhido.id
                  ? 'rounded-lg bg-[var(--color-acento-suave)] px-2.5 py-1 text-[13px] font-medium text-[var(--color-acento)]'
                  : 'rounded-lg px-2.5 py-1 text-[13px] text-[var(--color-tinta-2)] hover:bg-[var(--color-acento-suave)]'
              }
            >
              {f.nome}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {cli.dryRun && <Selo tom="alerta">modo seco</Selo>}
          <Selo tom={escolhido.status === 'publicado' ? 'ok' : 'neutro'}>{escolhido.status}</Selo>
        </div>
      </div>

      {cli.dryRun && (
        <p className="border-b bg-[var(--color-acento-suave)] px-4 py-2 text-xs text-[var(--color-tinta-2)]">
          {t['seco.aviso']}
        </p>
      )}

      <Construtor
        grafoInicial={carregado?.grafo ?? []}
        canais={canais}
        templates={porCanal}
        fluxos={fluxos.map((f) => ({ id: f.id, nome: f.nome }))}
        fluxoId={escolhido.id}
        podeEditar={s.permissoes.editarFluxos}
        t={t}
        aoSalvar={salvarFluxo}
      />
    </>
  )
}
