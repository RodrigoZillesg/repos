import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import { clientePadrao, listarClientes, listarTemplates } from '@/lib/dados'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES } from '@/lib/utils'
import { EditorTemplate } from '@/componentes/editor-template'
import { salvarTemplate, submeterAMeta } from './acoes'

export const dynamic = 'force-dynamic'

const NOME_CANAL = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' } as const
type CanalTpl = keyof typeof NOME_CANAL

export default async function PaginaTemplates({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; canal?: string; tpl?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (s.permissoes.templates.length === 0) redirect('/')

  const q = await searchParams
  const t = dicionarioDe(s.idioma)

  // O papel decide quais canais existem nesta tela. Um designer que digitar
  // ?canal=whatsapp na URL continua caindo no e-mail.
  const canaisPermitidos = s.permissoes.templates as readonly CanalTpl[]
  const canal = (canaisPermitidos.includes(q.canal as CanalTpl) ? q.canal : canaisPermitidos[0]) as CanalTpl

  const clientes = await listarClientes(s)
  const cli = await clientePadrao(s, q.cliente)
  if (!cli) return <p className="p-8 text-sm text-[var(--color-tinta-3)]">Nenhum cliente cadastrado.</p>

  const modelos = await listarTemplates(cli.id, canal)
  const escolhido = modelos.find((m) => m.id === q.tpl) ?? modelos[0]

  const base = `/templates?cliente=${cli.slug}`

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_260px_1fr]">
      <aside className="border-r p-4">
        <h3 className="mb-2 text-xs font-semibold text-[var(--color-tinta-3)]">
          {t['templates.biblioteca']}
        </h3>
        <nav className="space-y-0.5">
          {canaisPermitidos.map((c) => (
            <Link
              key={c}
              href={`${base}&canal=${c}` as '/templates'}
              className={
                c === canal
                  ? 'flex items-center gap-2 rounded-lg bg-[var(--color-acento-suave)] px-2 py-1.5 text-[13px] font-medium'
                  : 'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--color-tinta-2)] hover:bg-[var(--color-acento-suave)]'
              }
            >
              <Ponto cor={CORES[c]!} />
              {NOME_CANAL[c]}
            </Link>
          ))}
        </nav>

        {clientes.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 text-xs font-semibold text-[var(--color-tinta-3)]">
              {t['comum.cliente']}
            </h3>
            <nav className="space-y-0.5">
              {clientes.map((c) => (
                <Link
                  key={c.id}
                  href={`/templates?cliente=${c.slug}&canal=${canal}` as '/templates'}
                  className={
                    c.id === cli.id
                      ? 'block rounded-lg bg-[var(--color-acento-suave)] px-2 py-1.5 text-[13px] font-medium'
                      : 'block rounded-lg px-2 py-1.5 text-[13px] text-[var(--color-tinta-2)] hover:bg-[var(--color-acento-suave)]'
                  }
                >
                  {c.nome}
                </Link>
              ))}
            </nav>
          </>
        )}

        <Cartao className="mt-6 p-3">
          <p className="text-xs leading-relaxed text-[var(--color-tinta-2)]">
            Uma conexão só, da Avexa. O remetente é sempre um endereço do domínio da Avexa, com
            resposta direcionada ao time do cliente. Nenhum cliente configura DNS.
          </p>
        </Cartao>
      </aside>

      <div className="border-r">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <h2 className="text-[13px] font-semibold">{NOME_CANAL[canal]}</h2>
          <span className="text-xs text-[var(--color-tinta-3)]">{modelos.length}</span>
        </div>
        <ul className="divide-y">
          {modelos.map((m) => (
            <li key={m.id}>
              <Link
                href={`${base}&canal=${canal}&tpl=${m.id}` as '/templates'}
                className={
                  m.id === escolhido?.id
                    ? 'block bg-[var(--color-acento-suave)] px-3 py-2.5'
                    : 'block px-3 py-2.5 hover:bg-[var(--color-acento-suave)]'
                }
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{m.nome}</span>
                  <Selo
                    tom={m.status === 'aprovado' ? 'ok' : m.status === 'rejeitado' ? 'alerta' : 'neutro'}
                  >
                    {t[`templates.${m.status}` as 'templates.aprovado']}
                  </Selo>
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--color-tinta-3)]">
                  {m.corpo.slice(0, 60)}
                </span>
              </Link>
            </li>
          ))}
          {modelos.length === 0 && (
            <li className="p-3 text-xs text-[var(--color-tinta-3)]">Nenhum template neste canal.</li>
          )}
        </ul>
      </div>

      <div className="min-h-0 overflow-y-auto p-4">
        {escolhido ? (
          <EditorTemplate
            key={escolhido.id}
            clienteNome={cli.nome}
            template={{
              id: escolhido.id,
              nome: escolhido.nome,
              canal: escolhido.canal,
              assunto: escolhido.assunto,
              corpo: escolhido.corpo,
              variaveis: escolhido.variaveis,
              status: escolhido.status,
              metaMotivoRejeicao: escolhido.metaMotivoRejeicao,
              hashAprovado: escolhido.hashAprovado,
            }}
            t={t}
            aoSalvar={salvarTemplate}
            aoSubmeter={submeterAMeta}
          />
        ) : (
          <p className="text-sm text-[var(--color-tinta-3)]">Escolha um template.</p>
        )}
      </div>
    </div>
  )
}
