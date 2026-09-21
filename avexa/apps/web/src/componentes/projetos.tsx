'use client'

import { useState, useTransition } from 'react'
import { Archive, Check, Pencil, Plus, TriangleAlert, X } from 'lucide-react'
import type { Projeto, ResultadoCanal, ResultadoProjeto } from '@avexa/servicos'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'

/** As frentes de trabalho de um cliente.
 *
 *  Existe por causa do nome do número de telefone. Um cliente com duas escolas
 *  ou duas campanhas tem um número para cada, e chamar os dois pelo nome do
 *  cliente deixa a conta do Twilio como a antiga está: uma coluna de números
 *  que ninguém sabe de quem são, descoberta quando chega a fatura.
 *
 *  Arquivar em vez de apagar: o número que carrega o nome do projeto continua
 *  no ar, e apagar o projeto apagaria a explicação do nome dele. */

interface Props {
  clienteId: string
  projetos: Projeto[]
  podeAdministrar: boolean
  aoCriar: (clienteId: string, nome: string) => Promise<ResultadoProjeto>
  aoRenomear: (clienteId: string, projetoId: string, nome: string) => Promise<ResultadoProjeto>
  aoArquivar: (clienteId: string, projetoId: string) => Promise<ResultadoProjeto>
  aoAlternarSeco: (
    clienteId: string,
    projetoId: string,
    nome: string,
    dryRun: boolean,
  ) => Promise<ResultadoCanal>
}

export function Projetos({
  clienteId,
  projetos,
  podeAdministrar,
  aoCriar,
  aoRenomear,
  aoArquivar,
  aoAlternarSeco,
}: Props) {
  const [novo, setNovo] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null)
  const [rodando, iniciar] = useTransition()
  const travado = !podeAdministrar || rodando

  const mostrar = (r: ResultadoProjeto | ResultadoCanal, sucesso: string) =>
    setMsg(
      !r.ok
        ? { tom: 'erro', texto: r.erro }
        : r.aviso
          ? { tom: 'aviso', texto: r.aviso }
          : { tom: 'ok', texto: sucesso },
    )

  const criar = () => {
    if (!novo.trim()) return
    iniciar(async () => {
      mostrar(await aoCriar(clienteId, novo), 'Projeto criado.')
      setNovo('')
    })
  }

  const ativos = projetos.filter((p) => p.ativo)
  const arquivados = projetos.filter((p) => !p.ativo)

  return (
    <Cartao>
      <h3 className="text-sm font-semibold">Projetos</h3>
      <Ajuda>
        Frentes de trabalho deste cliente: duas escolas da mesma rede, duas campanhas, dois idiomas.
        Cada uma tem o próprio número, os próprios canais, agente, templates e destino de entrega —
        e o próprio modo seco, para virar a torneira de uma sem mexer na outra.
      </Ajuda>

      {ativos.length > 0 && (
        <ul className="mt-3 divide-y overflow-hidden rounded-[var(--radius-cartao)] border">
          {ativos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
              {editando === p.id ? (
                <>
                  <Entrada
                    value={nome}
                    autoFocus
                    maxLength={40}
                    disabled={travado}
                    onChange={(e) => setNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nome.trim()) {
                        iniciar(async () => mostrar(await aoRenomear(clienteId, p.id, nome), 'Nome trocado.'))
                        setEditando(null)
                      }
                      if (e.key === 'Escape') setEditando(null)
                    }}
                    className="max-w-xs flex-1"
                    aria-label={`Nome do projeto ${p.nome}`}
                  />
                  <Botao
                    tamanho="pequeno"
                    disabled={travado || !nome.trim()}
                    onClick={() => {
                      iniciar(async () => mostrar(await aoRenomear(clienteId, p.id, nome), 'Nome trocado.'))
                      setEditando(null)
                    }}
                  >
                    <Check aria-hidden size={12} />
                  </Botao>
                  <Botao variante="fantasma" tamanho="pequeno" onClick={() => setEditando(null)}>
                    <X aria-hidden size={12} />
                  </Botao>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{p.nome}</span>
                    <span className="block font-mono text-[11px] text-[var(--color-tinta-3)]">
                      /{p.slug}/
                    </span>
                  </span>
                  <Selo tom={p.numeros > 0 ? 'acento' : 'neutro'}>
                    {p.numeros === 1 ? '1 número' : `${p.numeros} números`}
                  </Selo>
                  {/* O modo seco é por frente: esta escola pode rodar em
                      espelho enquanto a outra já contata gente de verdade. */}
                  <Botao
                    variante={p.dryRun ? 'contorno' : 'fantasma'}
                    tamanho="pequeno"
                    disabled={travado}
                    title={
                      p.dryRun
                        ? 'O fluxo roda inteiro e nada é enviado. Desligar abre a torneira desta frente.'
                        : 'Os contatos desta frente saem de verdade.'
                    }
                    onClick={() =>
                      iniciar(async () =>
                        mostrar(
                          await aoAlternarSeco(clienteId, p.id, p.nome, !p.dryRun),
                          p.dryRun ? 'Modo seco desligado.' : 'Modo seco ligado.',
                        ),
                      )
                    }
                  >
                    {p.dryRun ? 'modo seco' : 'no ar'}
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="pequeno"
                    disabled={travado}
                    onClick={() => {
                      setNome(p.nome)
                      setEditando(p.id)
                    }}
                  >
                    <Pencil aria-hidden size={12} />
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="pequeno"
                    disabled={travado}
                    title="Arquivar: some das listas, sem mexer no número que já leva o nome"
                    onClick={() =>
                      iniciar(async () => mostrar(await aoArquivar(clienteId, p.id), 'Projeto arquivado.'))
                    }
                  >
                    <Archive aria-hidden size={12} />
                  </Botao>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Entrada
          value={novo}
          maxLength={40}
          disabled={travado}
          placeholder="Nome do projeto"
          aria-label="Nome do projeto novo"
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && criar()}
          className="max-w-xs flex-1"
        />
        <Botao variante="contorno" tamanho="pequeno" disabled={travado || !novo.trim()} onClick={criar}>
          <Plus aria-hidden size={12} />
          Adicionar
        </Botao>
      </div>

      {arquivados.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-tinta-3)]">
          Arquivados: {arquivados.map((p) => p.nome).join(', ')}. Criar de novo com o mesmo nome os
          traz de volta.
        </p>
      )}

      {msg && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
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
    </Cartao>
  )
}
