import { redirect } from 'next/navigation'
import { sessaoAtual } from '@/lib/auth'
import { dicionarioDe } from '@/i18n/dicionario'
import { listarClientes } from '@/lib/dados'
import { Cartao, Selo } from '@/componentes/ui/cartao'

export const dynamic = 'force-dynamic'

/** Os 9 passos da ativação. Oito são nossos; um depende do cliente, e é o único
 *  que ele precisa entender. A distinção fica visível de propósito: é o que
 *  sustenta a promessa comercial de "cliente novo no ar sem trabalho dele". */
const PASSOS = [
  {
    n: 'Cadastrar o cliente',
    d: 'Nome, o que ele vende, canais contratados, horários de contato e onde os leads qualificados devem chegar.',
    tag: 'auto',
  },
  {
    n: 'Gerar as URLs de entrada',
    d: 'Cada fluxo ganha um endereço de webhook próprio, pronto para receber UTMs e campos personalizados.',
    tag: 'auto',
  },
  {
    n: 'Reservar o número de voz',
    d: 'Um número do pool é atribuído ao cliente e configurado com a assistente. Voz é o único canal com número dedicado, e o mesmo número manda o SMS.',
    tag: 'auto',
  },
  {
    n: 'Ligar WhatsApp e SMS',
    d: 'Nenhum cadastro novo. O cliente entra no roteamento dos números da Avexa, que já têm conta verificada e templates aprovados.',
    tag: 'auto',
  },
  {
    n: 'Criar os templates de e-mail',
    d: 'A biblioteca do cliente nasce a partir dos modelos da Avexa, já com a cor e o logo da marca dele, pronta para o time de design ajustar.',
    tag: 'auto',
  },
  {
    n: 'Gerar roteiro e textos',
    d: 'Roteiro da ligação e variáveis dos templates preenchidos a partir do que o cliente vende, prontos para revisão do copywriter.',
    tag: 'auto',
  },
  {
    n: 'Montar os fluxos',
    d: 'Modelos carregados conforme os canais contratados. Daqui em diante é ajuste fino no construtor.',
    tag: 'auto',
  },
  {
    n: 'Cliente cola a URL e publica o opt-in',
    d: 'A única coisa que depende dele: apontar o formulário para o webhook e deixar visível que o contato virá pela Avexa.',
    tag: 'cli',
  },
  {
    n: 'Rodar o lead de teste',
    d: 'Um contato real de ponta a ponta antes de abrir a torneira, com a equipe acompanhando a transcrição.',
    tag: 'auto',
  },
] as const

export default async function PaginaAtivar() {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verClientes) redirect('/')

  const t = dicionarioDe(s.idioma)
  const clientes = await listarClientes(s)

  return (
    <div className="mx-auto w-full max-w-4xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">{t['ativar.titulo']}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        {t['ativar.descricao']}
      </p>

      <section className="mt-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{t['ativar.sequencia']}</h2>
          <Selo tom="acento">{t['ativar.automatico']}</Selo>
          <Selo tom="alerta">{t['ativar.depende']}</Selo>
        </div>

        <ol className="divide-y overflow-hidden rounded-[var(--radius-cartao)] border">
          {PASSOS.map((p, i) => (
            <li key={p.n} className="flex gap-3 bg-[var(--color-superficie)] p-3.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs text-[var(--color-tinta-3)]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{p.n}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-tinta-2)]">
                  {p.d}
                </span>
              </span>
              <Selo tom={p.tag === 'auto' ? 'acento' : 'alerta'} className="h-fit shrink-0">
                {p.tag === 'auto' ? t['ativar.automatico'] : t['ativar.depende']}
              </Selo>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <Cartao>
          <p className="text-2xl font-semibold">1</p>
          <h3 className="mt-1.5 text-[13px] font-medium">URL para o cliente</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-tinta-2)]">
            O nó de entrada gera o endereço do webhook. É a única coisa técnica que entregamos, e
            serve para formulário, CRM ou qualquer fonte de lead.
          </p>
        </Cartao>
        <Cartao>
          <p className="text-2xl font-semibold">0</p>
          <h3 className="mt-1.5 text-[13px] font-medium">Cadastros por canal</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-tinta-2)]">
            WhatsApp, SMS e e-mail já estão registrados na marca Avexa. Cliente novo entra no
            roteamento, não em um cadastro novo.
          </p>
        </Cartao>
        <Cartao>
          <p className="text-2xl font-semibold">∞</p>
          <h3 className="mt-1.5 text-[13px] font-medium">Fluxos por cliente</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-tinta-2)]">
            Um para lead novo, outro para base fria, outro para confirmação de reunião. Cada um com
            sua própria URL de entrada.
          </p>
        </Cartao>
      </section>

      <section className="mt-7">
        <h2 className="mb-3 text-sm font-semibold">Clientes no ar</h2>
        <ul className="divide-y overflow-hidden rounded-[var(--radius-cartao)] border">
          {clientes.map((c) => (
            <li key={c.id} className="flex items-center gap-3 bg-[var(--color-superficie)] p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{c.nome}</span>
                <span className="block text-xs text-[var(--color-tinta-3)]">
                  {c.setor} · {c.fusoHorario}
                </span>
              </span>
              <code className="hidden truncate font-mono text-[11px] text-[var(--color-tinta-3)] sm:block">
                hooks.avexa.global/v1/{c.slug}/…
              </code>
              {c.dryRun && <Selo tom="alerta">seco</Selo>}
              <Selo tom={c.status === 'ativo' ? 'ok' : 'neutro'}>{c.status}</Selo>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
