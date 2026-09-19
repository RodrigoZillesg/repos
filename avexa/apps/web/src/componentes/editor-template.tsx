'use client'

import { useState, useTransition } from 'react'
import { variaveisDe, renderizar } from '@avexa/core'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, AreaTexto, Entrada, Rotulo } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import type { Chave } from '@/i18n/dicionario'
import type { EntradaTemplate } from '@/app/(painel)/templates/acoes'

interface Props {
  /** Nome do cliente dono desta biblioteca, para a prévia não mostrar o de outro. */
  clienteNome: string
  template: {
    id: string
    nome: string
    canal: string
    assunto: string | null
    corpo: string
    variaveis: Record<string, string>
    status: string
    metaMotivoRejeicao: string | null
    hashAprovado: string | null
  }
  t: Record<Chave, string>
  aoSalvar: (e: EntradaTemplate) => Promise<{ ok: boolean; erro?: string; statusNovo?: string }>
  aoSubmeter: (id: string) => Promise<{ ok: boolean; erro?: string }>
}

export function EditorTemplate({ clienteNome, template, t, aoSalvar, aoSubmeter }: Props) {
  const [nome, setNome] = useState(template.nome)
  const [assunto, setAssunto] = useState(template.assunto ?? '')
  const [corpo, setCorpo] = useState(template.corpo)
  const [variaveis, setVariaveis] = useState(template.variaveis)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const nomes = variaveisDe(corpo)
  const textoMudou = corpo.trim() !== template.corpo.trim()
  const previa = renderizar(corpo, { ...variaveis, nome: 'Ana Ribeiro', cliente: clienteNome })

  function salvar() {
    iniciar(async () => {
      const r = await aoSalvar({ id: template.id, nome, assunto: assunto || null, corpo, variaveis })
      setAviso(
        r.ok
          ? r.statusNovo === 'rascunho'
            ? 'Texto fixo alterado: o template voltou a rascunho e precisa de nova aprovação.'
            : 'Salvo.'
          : (r.erro ?? 'falhou'),
      )
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">{template.nome}</h1>
        <Selo
          tom={
            template.status === 'aprovado' ? 'ok' : template.status === 'rejeitado' ? 'alerta' : 'neutro'
          }
        >
          {t[`templates.${template.status}` as 'templates.aprovado']}
        </Selo>
        {template.canal === 'whatsapp' && template.status === 'aprovado' && textoMudou && (
          <Selo tom="alerta">texto fixo alterado</Selo>
        )}
      </div>

      {template.metaMotivoRejeicao && (
        <Cartao className="mb-4 border-[var(--color-alerta)]">
          <p className="text-xs leading-relaxed text-[var(--color-alerta)]">
            Meta: {template.metaMotivoRejeicao}
          </p>
        </Cartao>
      )}

      <div className="mb-3">
        <Rotulo htmlFor="nome">Nome</Rotulo>
        <Entrada id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>

      {template.canal === 'email' && (
        <div className="mb-3">
          <Rotulo htmlFor="assunto">Assunto</Rotulo>
          <Entrada id="assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        </div>
      )}

      <div className="mb-3">
        <Rotulo htmlFor="corpo">Texto fixo</Rotulo>
        <AreaTexto
          id="corpo"
          rows={7}
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          className="font-mono text-xs"
        />
        <Ajuda>
          {t['templates.avisoTexto']} Use <code>{'{{variavel}}'}</code> para o que muda por lead.
        </Ajuda>
      </div>

      {nomes.length > 0 && (
        <div className="mb-3">
          <Rotulo>Variáveis</Rotulo>
          <div className="space-y-1.5">
            {nomes.map((n) => (
              <div key={n} className="flex items-center gap-2">
                <code className="w-32 shrink-0 truncate font-mono text-xs text-[var(--color-tinta-3)]">
                  {n}
                </code>
                <Entrada
                  value={variaveis[n] ?? ''}
                  placeholder="valor padrão"
                  onChange={(e) => setVariaveis({ ...variaveis, [n]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <Ajuda>
            Estes são valores padrão. O dado que vier do lead tem precedência sobre eles.
          </Ajuda>
        </div>
      )}

      <Cartao className="mb-4 bg-[var(--color-fundo)]">
        <p className="mb-1.5 text-xs font-medium text-[var(--color-tinta-3)]">Prévia</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{previa.texto}</p>
        {previa.faltando.length > 0 && (
          <p className="mt-2 text-xs text-[var(--color-alerta)]">
            Sem valor: {previa.faltando.join(', ')}
          </p>
        )}
      </Cartao>

      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={salvar} disabled={pendente}>
          {t['comum.salvar']}
        </Botao>
        {template.canal === 'whatsapp' && (
          <Botao
            variante="contorno"
            disabled={pendente || template.status === 'pendente'}
            onClick={() => iniciar(async () => {
              const r = await aoSubmeter(template.id)
              setAviso(r.ok ? 'Submetido. A Meta responde o status por webhook.' : (r.erro ?? 'falhou'))
            })}
          >
            {t['templates.submeter']}
          </Botao>
        )}
        {aviso && <span className="text-xs text-[var(--color-tinta-2)]">{aviso}</span>}
      </div>
    </div>
  )
}
