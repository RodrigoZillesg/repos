import { redirect } from 'next/navigation'
import { sessaoAtual } from '@/lib/auth'
import { DESCRICAO_PAPEL, PERMISSOES, type Papel } from '@/lib/papeis'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const CAMADAS = [
  {
    nome: 'Painel Avexa',
    sub: 'onde a Platty opera',
    itens: ['Cadastro de cliente', 'Construtor de fluxo', 'Biblioteca de templates', 'Papéis e acessos', 'Provisionamento', 'Monitor'],
  },
  {
    nome: 'Motor de fluxo',
    sub: 'executa o que o construtor desenhou',
    itens: ['Fila de tentativas', 'Agendador', 'Avaliador de condições', 'Chamada de subfluxo', 'Cadência', 'Supressão global'],
    nota: 'Cada tentativa de contato é um registro: para quem, de qual cliente, em qual fluxo, por qual canal, em que passo, com que resultado.',
  },
  {
    nome: 'Adaptadores',
    sub: 'mesma interface: enviar, receber, status',
    itens: ['Ligação', 'WhatsApp', 'SMS', 'E-mail', 'Telegram (em breve)'],
    nota: 'Acrescentar Telegram, RCS ou Instagram Direct é escrever um adaptador novo. Nenhum fluxo de cliente precisa ser alterado.',
  },
  {
    nome: 'Fornecedores',
    sub: 'trocáveis peça por peça',
    itens: ['Voz: Vapi sobre Twilio', 'WhatsApp: Cloud API oficial', 'SMS: Twilio', 'E-mail: Resend'],
  },
] as const

const COMPARTILHADO = [
  ['E-mail', 'Conexão única no Resend, domínio e reputação de envio', 'Templates próprios, com logo, cores e variáveis da marca'],
  ['WhatsApp', 'Números da marca, conta verificada, templates aprovados', 'Só o valor das variáveis: empresa, curso, data'],
  ['SMS', 'Campanha registrada e número remetente', 'Texto dentro do formato já aprovado'],
  ['Ligação', 'Pool de números e a camada de IA', 'Número dedicado, roteiro e base de conhecimento'],
  ['Fluxos', 'Modelos de partida e os nós disponíveis', 'Quantos fluxos quiser, cada um com sua URL de entrada'],
  ['Supressão', 'Lista única por pessoa, válida em todo canal e todo cliente', 'Nada: ninguém tem lista própria'],
] as const

const REGRAS = [
  ['Um canal por vez', 'Nunca dois disparos para a mesma pessoa na mesma janela, mesmo que o fluxo peça.'],
  ['Parada na primeira resposta', 'Respondeu em qualquer canal, o resto da sequência é cancelado.'],
  ['Opt-out vale em tudo', 'Um pedido de parada bloqueia todos os canais, para sempre, em qualquer cliente.'],
  ['Só em horário útil', 'Fuso do lead. Fora da janela, a tentativa espera a manhã seguinte.'],
  ['Teto de tentativas', 'O fluxo pode pedir menos que o teto do sistema, nunca mais.'],
  ['Subfluxo não vira laço', 'Um fluxo pode chamar outro, mas o motor corta a cadeia se ela voltar ao ponto de partida.'],
] as const

export default async function PaginaArquitetura() {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verFluxos) redirect('/')

  const lingua = s.idioma === 'en' ? 'en' : 'pt'

  return (
    <div className="mx-auto w-full max-w-4xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Como o sistema se sustenta</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        O motor de fluxo não sabe o que é Resend nem o que é WhatsApp. Ele emite uma intenção de
        contato e um adaptador traduz. É isso que permite trocar de fornecedor sem reescrever produto
        e acrescentar Telegram sem tocar em nenhum fluxo existente.
      </p>

      <div className="mt-7 space-y-2">
        {CAMADAS.map((c, i) => (
          <div key={c.nome}>
            <Cartao>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold">{c.nome}</h2>
                <span className="text-xs text-[var(--color-tinta-3)]">{c.sub}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {c.itens.map((x) => (
                  <Selo key={x}>{x}</Selo>
                ))}
              </div>
              {'nota' in c && c.nota && (
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-tinta-2)]">{c.nota}</p>
              )}
            </Cartao>
            {i < CAMADAS.length - 1 && (
              <div aria-hidden className="py-1 text-center text-[var(--color-tinta-3)]">
                ↓
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-9 text-base font-semibold">Quem pode mexer em quê</h2>
      <p className="mb-3 mt-1 text-[13px] text-[var(--color-tinta-2)]">
        Designers e copywriters entram no painel sem enxergar fluxos, clientes ou dados de lead.
      </p>
      <div className="overflow-x-auto rounded-[var(--radius-cartao)] border">
        <table className="w-full text-[13px]">
          <thead className="bg-[var(--color-superficie)] text-left text-xs text-[var(--color-tinta-3)]">
            <tr>
              <th className="p-3 font-medium">Papel</th>
              <th className="p-3 font-medium">Templates</th>
              <th className="p-3 font-medium">Fluxos</th>
              <th className="p-3 font-medium">Leads</th>
              <th className="p-3 font-medium">O que enxerga</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(Object.keys(PERMISSOES) as Papel[]).map((p) => {
              const perm = PERMISSOES[p]
              return (
                <tr key={p} className="bg-[var(--color-superficie)]">
                  <td className="p-3 font-medium capitalize">{p}</td>
                  <td className="p-3">
                    {perm.templates.length === 0 ? (
                      <span className="text-[var(--color-tinta-3)]">—</span>
                    ) : (
                      <span className="flex gap-1">
                        {perm.templates.map((c) => (
                          <Ponto key={c} cor={CORES[c]!} />
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{perm.editarFluxos ? 'edita' : perm.verFluxos ? 'vê' : '—'}</td>
                  <td className="p-3">{perm.verLeads ? (perm.escopoCliente ? 'só os próprios' : 'todos') : '—'}</td>
                  <td className="p-3 text-xs text-[var(--color-tinta-2)]">
                    {DESCRICAO_PAPEL[p][lingua]}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-9 text-base font-semibold">Compartilhado e por cliente</h2>
      <div className="mt-3 overflow-x-auto rounded-[var(--radius-cartao)] border">
        <table className="w-full text-[13px]">
          <thead className="bg-[var(--color-superficie)] text-left text-xs text-[var(--color-tinta-3)]">
            <tr>
              <th className="p-3 font-medium">Recurso</th>
              <th className="p-3 font-medium">Compartilhado pela Avexa</th>
              <th className="p-3 font-medium">Por cliente</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {COMPARTILHADO.map(([r, c, p]) => (
              <tr key={r} className="bg-[var(--color-superficie)]">
                <td className="p-3 font-medium">{r}</td>
                <td className="p-3 text-[var(--color-tinta-2)]">{c}</td>
                <td className="p-3 text-[var(--color-tinta-2)]">{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-9 text-base font-semibold">Regras que o motor aplica sozinho</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REGRAS.map(([t, d]) => (
          <Cartao key={t}>
            <h3 className="text-[13px] font-medium">{t}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-tinta-2)]">{d}</p>
          </Cartao>
        ))}
      </div>
    </div>
  )
}
