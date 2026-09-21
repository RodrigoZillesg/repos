'use client'

import { useState, useTransition } from 'react'
import { Phone, TriangleAlert } from 'lucide-react'
import type { Canal } from '@avexa/core'
import type { CadastroDoCliente, EstadoCanal, ResultadoCanal } from '@avexa/servicos'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Ponto, Selo } from '@/componentes/ui/cartao'
import { CORES } from '@/lib/utils'

/** Um cliente depois de ativado.
 *
 *  Ligar um canal não é virar uma chave: SMS e ligação saem do número do
 *  próprio cliente, e a ligação ainda precisa do agente publicado na Vapi. Um
 *  canal marcado como ativo sem esses pré-requisitos é o pior resultado
 *  possível — o painel diz que está tudo certo, o fluxo tem a etapa, e nenhum
 *  contato sai. Por isso cada canal mostra o que falta, em vez de deixar ligar
 *  e falhar depois. */

const NOME_CANAL: Record<string, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'E-mail',
}

/** Fusos que a operação realmente usa. Uma lista completa teria 400 entradas e
 *  nenhuma delas seria mais fácil de achar. */
const FUSOS = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
]

interface Props {
  clienteId: string
  slug: string
  inicial: CadastroDoCliente
  canais: EstadoCanal[]
  podeAdministrar: boolean
  aoSalvar: (clienteId: string, d: CadastroDoCliente) => Promise<ResultadoCanal>
  aoAlternarCanal: (clienteId: string, canal: Canal, ativo: boolean) => Promise<ResultadoCanal>
}

export function Cliente({
  clienteId,
  slug,
  inicial,
  canais,
  podeAdministrar,
  aoSalvar,
  aoAlternarCanal,
}: Props) {
  const [f, setF] = useState<CadastroDoCliente>(inicial)
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null)
  const [rodando, iniciar] = useTransition()
  const travado = !podeAdministrar || rodando

  const campo = <K extends keyof CadastroDoCliente>(k: K, v: CadastroDoCliente[K]) =>
    setF((x) => ({ ...x, [k]: v }))

  const mostrar = (r: ResultadoCanal, sucesso: string) =>
    setMsg(
      !r.ok
        ? { tom: 'erro', texto: r.erro }
        : r.aviso
          ? { tom: 'aviso', texto: r.aviso }
          : { tom: 'ok', texto: sucesso },
    )

  return (
    <div className="grid gap-4">
      <Cartao>
        <h3 className="text-sm font-semibold">Cadastro</h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="cl-nome">Nome</Rotulo>
            <Entrada
              id="cl-nome"
              value={f.nome}
              disabled={travado}
              onChange={(e) => campo('nome', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="cl-fuso">Fuso horário</Rotulo>
            <Selecao
              id="cl-fuso"
              value={f.fusoHorario}
              disabled={travado}
              onChange={(e) => campo('fusoHorario', e.target.value)}
            >
              {FUSOS.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
              {/* Fuso salvo fora da lista curta: fica visível para não ser
                  trocado sem querer ao salvar. */}
              {!FUSOS.includes(f.fusoHorario) && <option value={f.fusoHorario}>{f.fusoHorario}</option>}
            </Selecao>
            <Ajuda>Decide a janela de contato. É o relógio do lead que manda.</Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="cl-pais">País</Rotulo>
            <Entrada
              id="cl-pais"
              value={f.pais}
              maxLength={2}
              disabled={travado}
              onChange={(e) => campo('pais', e.target.value.toUpperCase())}
              className="w-20 font-mono"
            />
            <Ajuda>
              Decide como um telefone sem DDI é normalizado. Errado aqui, o telefone de todo lead se
              perde — e com ele a ligação e o SMS.
            </Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="cl-slug">Identificador na URL</Rotulo>
            <Entrada id="cl-slug" value={slug} readOnly className="font-mono text-xs" />
            <Ajuda>
              Não muda: compõe a URL de webhook que o cliente já colou no formulário dele. Trocar
              faria os leads pararem de chegar, sem aviso.
            </Ajuda>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={f.dryRun}
            disabled={travado}
            onChange={(e) => campo('dryRun', e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-acento)]"
          />
          <span>
            Modo seco
            <span className="block text-xs text-[var(--color-tinta-3)]">
              O fluxo roda inteiro e cada tentativa fica gravada, mas nada é enviado. Desligar é o
              que abre a torneira de verdade.
            </span>
          </span>
        </label>

        <div className="mt-4">
          <Botao
            disabled={travado}
            onClick={() => iniciar(async () => mostrar(await aoSalvar(clienteId, f), 'Salvo.'))}
          >
            Salvar cadastro
          </Botao>
        </div>
      </Cartao>

      <Cartao>
        <h3 className="text-sm font-semibold">Canais contratados</h3>
        <Ajuda>
          Dá para mudar a qualquer momento. Desligar um canal faz o motor pular as etapas dele nos
          fluxos publicados, a partir da próxima entrada de lead.
        </Ajuda>

        <ul className="mt-3 divide-y overflow-hidden rounded-[var(--radius-cartao)] border">
          {canais.map((c) => (
            <li key={c.canal} className="flex flex-wrap items-center gap-3 p-3">
              <Ponto cor={CORES[c.canal] ?? 'var(--color-logica)'} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{NOME_CANAL[c.canal] ?? c.canal}</span>
                  {c.ativo ? <Selo tom="ok">contratado</Selo> : <Selo>não contratado</Selo>}
                  {c.numero && <Selo tom="acento">{c.numero}</Selo>}
                </span>
                {/* O que impede ligar, dito antes de alguém tentar. */}
                {!c.pronto && !c.ativo && (
                  <span className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-[var(--color-alerta)]">
                    <TriangleAlert aria-hidden size={12} className="mt-0.5 shrink-0" />
                    {c.falta}
                  </span>
                )}
                {c.ativo && c.fluxosPublicados > 0 && (
                  <span className="mt-1 block text-xs text-[var(--color-tinta-3)]">
                    {c.fluxosPublicados === 1
                      ? '1 fluxo publicado usa este canal.'
                      : `${c.fluxosPublicados} fluxos publicados usam este canal.`}
                  </span>
                )}
              </span>

              <Botao
                variante={c.ativo ? 'perigo' : 'contorno'}
                tamanho="pequeno"
                disabled={travado || (!c.ativo && !c.pronto)}
                onClick={() =>
                  iniciar(async () =>
                    mostrar(
                      await aoAlternarCanal(clienteId, c.canal, !c.ativo),
                      c.ativo
                        ? `${NOME_CANAL[c.canal]} desligado.`
                        : `${NOME_CANAL[c.canal]} ligado.`,
                    ),
                  )
                }
              >
                {c.ativo ? 'Desligar' : 'Ligar'}
              </Botao>
            </li>
          ))}
        </ul>

        {canais.some((c) => !c.pronto && !c.ativo && c.canal === 'ligacao') && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--color-tinta-3)]">
            <Phone aria-hidden size={12} className="mt-0.5 shrink-0" />
            O agente de voz e a importação do número ficam na tela de Agentes de voz.
          </p>
        )}
      </Cartao>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
            msg.tom === 'erro'
              ? 'border-[var(--color-perigo)] text-[var(--color-perigo)]'
              : msg.tom === 'aviso'
                ? 'border-[var(--color-alerta)]'
                : ''
          }`}
        >
          {msg.tom !== 'ok' && <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{msg.texto}</span>
        </div>
      )}

      {!podeAdministrar && (
        <p className="text-xs text-[var(--color-tinta-3)]">
          Você pode ver, mas só quem administra altera cliente e canal.
        </p>
      )}
    </div>
  )
}
