'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Minus, TriangleAlert } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, AreaTexto, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES } from '@/lib/utils'
import type { Chave } from '@/i18n/dicionario'
import type { FormAtivacao } from '@/app/(painel)/ativar/acoes'
import type { ResultadoAtivacao } from '@avexa/servicos'

const FUSOS = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
]

const CANAIS = [
  { k: 'ligacao', nome: 'Ligação', nota: 'único canal com número dedicado' },
  { k: 'whatsapp', nome: 'WhatsApp', nota: 'números da marca Avexa' },
  { k: 'sms', nome: 'SMS', nota: 'mesmo número da ligação' },
  { k: 'email', nome: 'E-mail', nota: 'conexão única no Resend' },
] as const

interface Props {
  podeAtivar: boolean
  t: Record<Chave, string>
  aoAtivar: (e: FormAtivacao) => Promise<ResultadoAtivacao>
  /** Números já nossos e sem dono, para reaproveitar em vez de comprar. */
  numerosLivres: Array<{ e164: string; capacidades: string[]; apelido: string | null }>
  /** Países em que a conta do Twilio pode comprar. Vazio quando não deu para
   *  ler a conta; aí a tela pede a sigla à mão em vez de travar a compra. */
  paises: Array<{ iso: string; nome: string }>
}

export function Ativacao({ podeAtivar, t, aoAtivar, numerosLivres, paises }: Props) {
  const [form, setForm] = useState<FormAtivacao>({
    nome: '',
    slug: '',
    projeto: '',
    produto: '',
    setor: '',
    fusoHorario: 'Australia/Sydney',
    emailDoTime: '',
    canais: { ligacao: true, whatsapp: true, sms: true, email: true },
    fluxosExtras: '',
    // Pool primeiro: reaproveitar não custa nada, e comprar custa todo mês.
    numeroModo: 'existente',
    numeroE164: numerosLivres[0]?.e164 ?? '',
    numeroPais: '',
  })
  const [resultado, setResultado] = useState<ResultadoAtivacao | null>(null)
  const [pendente, iniciar] = useTransition()

  const campo = <K extends keyof FormAtivacao>(k: K, v: FormAtivacao[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  function enviar() {
    iniciar(async () => setResultado(await aoAtivar(form)))
  }

  if (resultado?.ok) {
    return <Concluido resultado={resultado} aoRecomecar={() => setResultado(null)} />
  }

  return (
    <Cartao>
      <h2 className="text-sm font-semibold">{t['ativar.acao']}</h2>
      <Ajuda>
        Oito dos nove passos são nossos. O único que depende do cliente é colar a URL na saída do
        formulário dele e publicar o opt-in.
      </Ajuda>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Rotulo htmlFor="a-nome">Nome do cliente</Rotulo>
          <Entrada
            id="a-nome"
            value={form.nome}
            onChange={(e) => campo('nome', e.target.value)}
            placeholder="International House"
          />
        </div>
        <div>
          <Rotulo htmlFor="a-setor">Setor</Rotulo>
          <Entrada
            id="a-setor"
            value={form.setor}
            onChange={(e) => campo('setor', e.target.value)}
            placeholder="Escola de idiomas"
          />
        </div>
        <div className="sm:col-span-2">
          <Rotulo htmlFor="a-projeto">Primeiro projeto</Rotulo>
          <Entrada
            id="a-projeto"
            value={form.projeto}
            onChange={(e) => campo('projeto', e.target.value)}
            placeholder={form.nome ? `${form.nome} — ex.: Sydney CBD` : 'Sydney CBD'}
          />
          <Ajuda>
            A frente de trabalho que vai ter número, canais, agente e fluxos. Um cliente pode ter
            várias — duas escolas da rede, duas campanhas —, cada uma com o telefone e a
            configuração dela. É este nome que batiza o número no Twilio. Em branco, leva o nome do
            cliente.
          </Ajuda>
        </div>
      </div>

      <div className="mt-3">
        <Rotulo htmlFor="a-produto">O que o cliente vende</Rotulo>
        <Entrada
          id="a-produto"
          value={form.produto}
          onChange={(e) => campo('produto', e.target.value)}
          placeholder="cursos de inglês em Sydney"
        />
        <Ajuda>
          Preenche as variáveis dos templates e o roteiro da assistente de voz. Escreva como você
          diria ao lead, não como está no contrato.
        </Ajuda>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Rotulo htmlFor="a-fuso">Fuso do cliente</Rotulo>
          <Selecao
            id="a-fuso"
            value={form.fusoHorario}
            onChange={(e) => campo('fusoHorario', e.target.value)}
          >
            {FUSOS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Selecao>
          <Ajuda>Define a janela de contato e como um telefone sem DDI é lido.</Ajuda>
        </div>
        <div>
          <Rotulo htmlFor="a-email">E-mail do time comercial</Rotulo>
          <Entrada
            id="a-email"
            type="email"
            value={form.emailDoTime}
            onChange={(e) => campo('emailDoTime', e.target.value)}
            placeholder="comercial@cliente.com"
          />
          <Ajuda>Para onde o lead qualificado é entregue.</Ajuda>
        </div>
      </div>

      <div className="mt-4">
        <Rotulo>Canais contratados</Rotulo>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CANAIS.map((c) => (
            <label
              key={c.k}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
            >
              <input
                type="checkbox"
                checked={form.canais[c.k] ?? false}
                onChange={(e) => campo('canais', { ...form.canais, [c.k]: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-acento)]"
              />
              <Ponto cor={CORES[c.k]!} />
              <span className="flex-1">{c.nome}</span>
              <span className="text-xs text-[var(--color-tinta-3)]">{c.nota}</span>
            </label>
          ))}
        </div>
      </div>

      {(form.canais.ligacao || form.canais.sms) && (
        <div className="mt-4">
          <Rotulo>Número de telefone do cliente</Rotulo>
          <div className="grid gap-1.5">
            {[
              // Havia duas opções aqui — "usar um que já temos" e "escolher
              // qual usar" — que faziam a mesma coisa: as duas tiram do pool, e
              // a primeira só escolhia sozinha. Duas portas para a mesma sala.
              {
                k: 'existente' as const,
                nome: 'Usar um número que já temos',
                nota: numerosLivres.length
                  ? `${numerosLivres.length} livre${numerosLivres.length > 1 ? 's' : ''}`
                  : 'nenhum livre',
                desabilitado: numerosLivres.length === 0,
              },
              {
                k: 'comprar' as const,
                nome: 'Comprar um número novo no Twilio',
                nota: 'passa a custar todo mês',
                desabilitado: false,
              },
            ].map((o) => (
              <label
                key={o.k}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] ${
                  o.desabilitado ? 'opacity-50' : 'cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="numero-modo"
                  checked={form.numeroModo === o.k}
                  disabled={o.desabilitado}
                  onChange={() => campo('numeroModo', o.k)}
                  className="h-4 w-4 accent-[var(--color-acento)]"
                />
                <span className="flex-1">{o.nome}</span>
                <span className="text-xs text-[var(--color-tinta-3)]">{o.nota}</span>
              </label>
            ))}
          </div>

          {form.numeroModo === 'existente' && numerosLivres.length > 0 && (
            <div className="mt-2">
              <Selecao
                id="a-numero-livre"
                value={form.numeroE164}
                onChange={(e) => campo('numeroE164', e.target.value)}
              >
                {numerosLivres.map((n) => (
                  <option key={n.e164} value={n.e164}>
                    {/* O nome do Twilio vem junto: sem ele a lista é uma coluna
                        de dígitos, e ninguém sabe qual número é qual. */}
                    {n.e164}
                    {n.apelido ? ` · ${n.apelido}` : ' · sem nome no Twilio'} ·{' '}
                    {n.capacidades.join(' + ')}
                  </option>
                ))}
              </Selecao>
              <Ajuda>O nome ao lado é o que está gravado no Twilio.</Ajuda>
            </div>
          )}

          {form.numeroModo === 'comprar' && (
            <div className="mt-2">
              {paises.length > 0 ? (
                <>
                  <Selecao
                    id="a-numero-pais"
                    value={form.numeroPais}
                    onChange={(e) => campo('numeroPais', e.target.value)}
                  >
                    <option value="">Mesmo país do cliente</option>
                    {paises.map((p) => (
                      <option key={p.iso} value={p.iso}>
                        {p.nome} ({p.iso})
                      </option>
                    ))}
                  </Selecao>
                  <Ajuda>
                    Só aparecem os países em que esta conta do Twilio pode comprar. Ligar de outro
                    país derruba a taxa de resposta.
                  </Ajuda>
                </>
              ) : (
                <>
                  {/* Sem conseguir ler a conta, pedir a sigla é pior mas ainda
                      deixa comprar. Travar seria pior ainda. */}
                  <Entrada
                    id="a-numero-pais"
                    value={form.numeroPais}
                    onChange={(e) => campo('numeroPais', e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="AU"
                    className="w-20 font-mono"
                  />
                  <Ajuda>
                    Não deu para ler os países da conta do Twilio agora. Informe a sigla de duas
                    letras, ou deixe em branco para usar o país do cliente.
                  </Ajuda>
                </>
              )}
            </div>
          )}

          <Ajuda>
            O mesmo número faz a ligação e manda o SMS — o lead precisa reconhecer quem o procurou.
            WhatsApp e e-mail saem sempre da Avexa.
          </Ajuda>
        </div>
      )}

      <div className="mt-3">
        <Rotulo htmlFor="a-fluxos">Fluxos além do padrão</Rotulo>
        <AreaTexto
          id="a-fluxos"
          rows={2}
          value={form.fluxosExtras}
          onChange={(e) => campo('fluxosExtras', e.target.value)}
          placeholder={'Recuperação por telefone\nConfirmação de reunião'}
        />
        <Ajuda>Um por linha. Cada fluxo ganha a sua própria URL de entrada.</Ajuda>
      </div>

      {resultado?.erro && (
        <p className="mt-3 text-xs text-[var(--color-alerta)]">{resultado.erro}</p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Botao onClick={enviar} disabled={!podeAtivar || pendente}>
          {pendente ? 'Provisionando…' : t['ativar.acao']}
        </Botao>
        {!podeAtivar && (
          <span className="text-xs text-[var(--color-tinta-3)]">
            Só o administrador ativa clientes.
          </span>
        )}
      </div>
    </Cartao>
  )
}

function Concluido({
  resultado,
  aoRecomecar,
}: {
  resultado: ResultadoAtivacao
  aoRecomecar: () => void
}) {
  const [copiada, setCopiada] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Cliente provisionado</h2>
          <Selo tom="alerta">modo seco</Selo>
        </div>
        <Ajuda>
          Nasce em modo seco de propósito: o fluxo roda inteiro e cada tentativa fica gravada, mas
          nada é enviado. Rode o lead de teste, olhe o resultado, e só então vire a chave.
        </Ajuda>

        {resultado.avisos.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-lg border border-[var(--color-alerta)] p-3">
            {resultado.avisos.map((a) => (
              <li key={a} className="flex items-start gap-2 text-xs leading-relaxed">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--color-alerta)]" />
                <span className="text-[var(--color-tinta-2)]">{a}</span>
              </li>
            ))}
          </ul>
        )}

        <ol className="mt-4 divide-y overflow-hidden rounded-lg border">
          {resultado.passos.map((p) => (
            <li key={p.n} className="flex items-start gap-2.5 p-2.5">
              <span className="pt-0.5">
                {p.estado === 'feito' ? (
                  <Check size={14} className="text-[var(--color-ok)]" />
                ) : p.estado === 'pulado' ? (
                  <Minus size={14} className="text-[var(--color-tinta-3)]" />
                ) : (
                  <TriangleAlert size={14} className="text-[var(--color-alerta)]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{p.nome}</span>
                <span className="block text-xs text-[var(--color-tinta-2)]">{p.detalhe}</span>
              </span>
            </li>
          ))}
          <li className="flex items-start gap-2.5 bg-[var(--color-acento-suave)] p-2.5">
            <span className="pt-0.5">
              <TriangleAlert size={14} className="text-[var(--color-acento)]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">
                Cliente cola a URL e publica o opt-in
              </span>
              <span className="block text-xs text-[var(--color-tinta-2)]">
                A única coisa que depende dele. Entregue as URLs abaixo.
              </span>
            </span>
          </li>
        </ol>
      </Cartao>

      <Cartao>
        <h2 className="text-sm font-semibold">URLs para entregar ao cliente</h2>
        <Ajuda>Uma por fluxo. Ele cola na saída do formulário, no CRM ou em qualquer fonte.</Ajuda>
        <ul className="mt-3 space-y-2">
          {resultado.urls.map((u) => (
            <li key={u.url} className="flex flex-wrap items-center gap-2">
              <span className="w-48 shrink-0 text-[13px]">{u.fluxo}</span>
              <code className="min-w-0 flex-1 truncate rounded-lg border bg-[var(--color-fundo)] px-2 py-1.5 font-mono text-xs">
                {u.url}
              </code>
              <Botao
                variante="contorno"
                tamanho="pequeno"
                onClick={() => {
                  void navigator.clipboard?.writeText(u.url)
                  setCopiada(u.url)
                }}
              >
                <Copy size={12} />
                {copiada === u.url ? 'copiada' : 'copiar'}
              </Botao>
            </li>
          ))}
        </ul>
      </Cartao>

      <Botao variante="contorno" onClick={aoRecomecar}>
        Ativar outro cliente
      </Botao>
    </div>
  )
}
