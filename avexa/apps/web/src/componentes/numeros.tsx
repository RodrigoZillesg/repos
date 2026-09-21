'use client'

import { useState, useTransition } from 'react'
import { Check, Pencil, TriangleAlert, X } from 'lucide-react'
import type { NumeroInventariado, ResultadoNumero } from '@avexa/servicos'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Selecao } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'

/** Os números que a conta do Twilio tem de verdade.
 *
 *  A lista sai do Twilio a cada carga, não de uma cópia nossa. Cópia envelhece:
 *  alguém compra ou renomeia no console e o painel continua mostrando ontem com
 *  cara de hoje — e em número de telefone isso custa dinheiro ou um lead que
 *  ligou de volta para lugar nenhum.
 *
 *  O apelido é a coisa mais importante da tela. É a única identificação que
 *  viaja com o número: aparece no console, na fatura e em qualquer ferramenta
 *  que leia a conta. Sem ele — que é como a conta antiga está — a lista é uma
 *  coluna de dígitos sem dono. */

interface ClienteDaLista {
  id: string
  nome: string
  projetos: Array<{ id: string; nome: string }>
}

interface Props {
  numeros: NumeroInventariado[]
  clientes: ClienteDaLista[]
  podeAdministrar: boolean
  aoRenomear: (sid: string, e164: string, apelido: string) => Promise<ResultadoNumero>
  aoAdotar: (
    sid: string,
    e164: string,
    clienteId: string,
    projetoId: string | null,
    capacidades: string[],
  ) => Promise<ResultadoNumero>
}

/** Esta tela mostra o que a conta do Twilio tem. Número que existe só na nossa
 *  tabela fica de fora: quem cobra isso é a prontidão, pelo `provedorSid`, e
 *  `numeros reais` na linha de comando continua listando os dois lados. */
const GRUPOS = ['avexa', 'fora'] as const

const TITULO: Record<(typeof GRUPOS)[number], string> = {
  avexa: 'Na Avexa',
  fora: 'Na conta do Twilio, fora da Avexa',
}

const EXPLICACAO: Record<(typeof GRUPOS)[number], string> = {
  avexa: 'Números atribuídos a um cliente daqui. O motor liga e manda SMS por eles.',
  fora:
    'Comprados fora da Avexa — a operação antiga. O nome é a única pista de quem é o dono. ' +
    'Dá para renomear, e dá para trazer para um cliente daqui.',
}

export function Numeros({ numeros, clientes, podeAdministrar, aoRenomear, aoAdotar }: Props) {
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null)
  const [rodando, iniciar] = useTransition()

  const mostrar = (r: ResultadoNumero, sucesso: string) =>
    setMsg(
      !r.ok
        ? { tom: 'erro', texto: r.erro }
        : r.aviso
          ? { tom: 'aviso', texto: r.aviso }
          : { tom: 'ok', texto: sucesso },
    )

  const grupos = GRUPOS.map((origem) => ({
    origem,
    itens: numeros.filter((n) => n.origem === origem),
  })).filter((g) => g.itens.length > 0)

  return (
    <div className="grid gap-4">
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

      {grupos.map((g) => (
        <Cartao key={g.origem}>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {TITULO[g.origem]}
            <Selo>{g.itens.length}</Selo>
          </h3>
          <Ajuda>{EXPLICACAO[g.origem]}</Ajuda>

          <ul className="mt-3 divide-y overflow-hidden rounded-[var(--radius-cartao)] border">
            {g.itens.map((n) => (
              <Linha
                key={n.e164}
                n={n}
                clientes={clientes}
                travado={!podeAdministrar || rodando}
                aoRenomear={(apelido) =>
                  iniciar(async () =>
                    mostrar(await aoRenomear(n.sid ?? '', n.e164, apelido), 'Nome trocado no Twilio.'),
                  )
                }
                aoAdotar={(clienteId, projetoId) =>
                  iniciar(async () =>
                    mostrar(
                      await aoAdotar(n.sid ?? '', n.e164, clienteId, projetoId, n.capacidades),
                      'Número trazido para a Avexa.',
                    ),
                  )
                }
              />
            ))}
          </ul>
        </Cartao>
      ))}

      {!podeAdministrar && (
        <p className="text-xs text-[var(--color-tinta-3)]">
          Você pode ver, mas só quem administra renomeia e atribui número.
        </p>
      )}
    </div>
  )
}

function Linha({
  n,
  clientes,
  travado,
  aoRenomear,
  aoAdotar,
}: {
  n: NumeroInventariado
  clientes: ClienteDaLista[]
  travado: boolean
  aoRenomear: (apelido: string) => void
  aoAdotar: (clienteId: string, projetoId: string | null) => void
}) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(n.apelido)
  const [adotando, setAdotando] = useState(false)
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? '')
  const [projetoId, setProjetoId] = useState('')

  const projetos = clientes.find((c) => c.id === clienteId)?.projetos ?? []
  // Sem SID não há o que renomear no Twilio.
  const podeRenomear = Boolean(n.sid)

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[13px] font-medium">{n.e164}</span>

        {n.capacidades.map((c) => (
          <Selo key={c}>{c}</Selo>
        ))}
        {n.status && <Selo tom={n.status === 'atribuido' ? 'acento' : 'neutro'}>{n.status}</Selo>}
        {n.clienteNome && (
          <span className="text-[13px] text-[var(--color-tinta-2)]">
            {n.clienteNome}
            {n.projetoNome && <span className="text-[var(--color-tinta-3)]"> · {n.projetoNome}</span>}
          </span>
        )}

        <span className="flex-1" />

        {podeRenomear && !editando && (
          <Botao
            variante="fantasma"
            tamanho="pequeno"
            disabled={travado}
            onClick={() => {
              setNome(n.apelido)
              setEditando(true)
            }}
          >
            <Pencil aria-hidden size={12} />
            Renomear
          </Botao>
        )}
        {n.origem === 'fora' && !adotando && clientes.length > 0 && (
          <Botao variante="contorno" tamanho="pequeno" disabled={travado} onClick={() => setAdotando(true)}>
            Trazer para um cliente
          </Botao>
        )}
      </div>

      {/* O nome, que é o ponto da tela.
          Quando ele já é exatamente o dono registrado aqui, a linha de cima
          acabou de dizer a mesma coisa — repetir só faz a lista render menos
          números por tela. */}
      {!editando && !(n.apelido !== '' && n.apelido === n.apelidoSugerido) && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
          {n.apelido ? (
            <span>{n.apelido}</span>
          ) : (
            <span className="text-[var(--color-alerta)]">sem nome no Twilio</span>
          )}
          {n.foraDoPadrao && n.apelidoSugerido && (
            <Botao
              variante="fantasma"
              tamanho="pequeno"
              disabled={travado}
              onClick={() => aoRenomear(n.apelidoSugerido!)}
              title={`Renomear para ${n.apelidoSugerido}`}
            >
              usar “{n.apelidoSugerido}”
            </Botao>
          )}
        </p>
      )}

      {editando && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Entrada
            value={nome}
            autoFocus
            maxLength={64}
            disabled={travado}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nome.trim()) {
                aoRenomear(nome)
                setEditando(false)
              }
              if (e.key === 'Escape') setEditando(false)
            }}
            className="max-w-sm flex-1"
            aria-label={`Nome do número ${n.e164}`}
          />
          <Botao
            tamanho="pequeno"
            disabled={travado || !nome.trim()}
            onClick={() => {
              aoRenomear(nome)
              setEditando(false)
            }}
          >
            <Check aria-hidden size={12} />
            Salvar
          </Botao>
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => setEditando(false)}>
            <X aria-hidden size={12} />
          </Botao>
          <span className="text-[11px] text-[var(--color-tinta-3)]">{nome.length}/64</span>
        </div>
      )}

      {adotando && (
        <div className="mt-2 grid gap-2 rounded-lg border border-[var(--color-alerta)] p-3">
          {/* Dito antes de clicar, não depois: o webhook do número passa a
              apontar para a Avexa, e quem recebe as respostas dele hoje deixa
              de receber. */}
          <p className="flex items-start gap-1.5 text-xs leading-snug text-[var(--color-alerta)]">
            <TriangleAlert aria-hidden size={12} className="mt-0.5 shrink-0" />
            Isto reaponta o webhook de SMS deste número para a Avexa. O que recebe as respostas dele
            hoje para de receber — inclusive os pedidos de parada dos leads.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Selecao
              value={clienteId}
              disabled={travado}
              onChange={(e) => {
                setClienteId(e.target.value)
                setProjetoId('')
              }}
              className="max-w-52"
              aria-label="Cliente"
            >
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
            <Selecao
              value={projetoId}
              disabled={travado || projetos.length === 0}
              onChange={(e) => setProjetoId(e.target.value)}
              className="max-w-52"
              aria-label="Projeto"
            >
              <option value="">
                {projetos.length === 0 ? 'nenhum projeto cadastrado' : 'sem projeto'}
              </option>
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
            <Botao
              tamanho="pequeno"
              disabled={travado || !clienteId}
              onClick={() => {
                aoAdotar(clienteId, projetoId || null)
                setAdotando(false)
              }}
            >
              Trazer
            </Botao>
            <Botao variante="fantasma" tamanho="pequeno" onClick={() => setAdotando(false)}>
              Cancelar
            </Botao>
          </div>
          <Ajuda>
            O número vira remetente de SMS e de ligação do cliente, e é renomeado no Twilio com o
            nome do cliente e do projeto.
          </Ajuda>
        </div>
      )}
    </li>
  )
}
