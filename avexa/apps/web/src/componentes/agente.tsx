'use client'

import { useState, useTransition } from 'react'
import { CloudUpload, Phone, TriangleAlert } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, AreaTexto, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import type { FormAgente, Resultado } from '@/app/(painel)/agentes/acoes'

interface Props {
  inicial: FormAgente
  clienteId: string
  clienteNome: string
  podeAdministrar: boolean
  /** Do banco, não da Vapi: é o que diz se há mudança não publicada. */
  publicado: boolean
  pendente: boolean
  numero: string | null
  vozIdNaVapi: string | null
  aoSalvar: (f: FormAgente) => Promise<Resultado>
  aoPublicar: (id: string) => Promise<Resultado>
  aoImportarNumero: (clienteId: string) => Promise<Resultado>
}

const IDIOMAS = [
  { v: 'en', n: 'Inglês' },
  { v: 'pt', n: 'Português' },
  { v: 'es', n: 'Espanhol' },
]

export function Agente({
  inicial,
  clienteId,
  clienteNome,
  podeAdministrar,
  publicado,
  pendente: temPendencia,
  numero,
  vozIdNaVapi,
  aoSalvar,
  aoPublicar,
  aoImportarNumero,
}: Props) {
  const [f, setF] = useState<FormAgente>(inicial)
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null)
  const [rodando, iniciar] = useTransition()
  const campo = <K extends keyof FormAgente>(k: K, v: FormAgente[K]) =>
    setF((x) => ({ ...x, [k]: v }))
  const travado = !podeAdministrar || rodando

  const mostrar = (r: Resultado, sucesso: string) =>
    setMsg(
      r.ok
        ? r.aviso
          ? { tom: 'aviso', texto: r.aviso }
          : { tom: 'ok', texto: sucesso }
        : { tom: 'erro', texto: r.erro ?? 'falhou' },
    )

  return (
    <div className="grid gap-4">
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{clienteNome}</h2>
          {publicado ? (
            temPendencia ? (
              <Selo tom="alerta">mudanças não publicadas</Selo>
            ) : (
              <Selo tom="acento">publicado na Vapi</Selo>
            )
          ) : (
            <Selo tom="alerta">ainda não publicado</Selo>
          )}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-[var(--color-tinta-3)]">
          Salvar guarda aqui. Publicar é o que muda o que sai na boca de quem ligar para um lead
          daqui a um minuto.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="ag-nome">Nome do agente</Rotulo>
            <Entrada
              id="ag-nome"
              value={f.nome}
              disabled={travado}
              onChange={(e) => campo('nome', e.target.value)}
            />
            <Ajuda>Só aparece no console da Vapi, para achar de quem é.</Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="ag-idioma">Idioma da conversa</Rotulo>
            <Selecao
              id="ag-idioma"
              value={f.idioma}
              disabled={travado}
              onChange={(e) => campo('idioma', e.target.value)}
            >
              {IDIOMAS.map((i) => (
                <option key={i.v} value={i.v}>
                  {i.n}
                </option>
              ))}
            </Selecao>
            <Ajuda>Decide o transcritor. Um agente serve qualquer idioma.</Ajuda>
          </div>
        </div>
      </Cartao>

      <Cartao>
        <h3 className="text-sm font-semibold">O que o agente diz</h3>

        <div className="mt-3">
          <Rotulo htmlFor="ag-primeira">Primeira fala</Rotulo>
          <AreaTexto
            id="ag-primeira"
            rows={3}
            value={f.primeiraMensagem}
            disabled={travado}
            onChange={(e) => campo('primeiraMensagem', e.target.value)}
          />
          <Ajuda>
            É literalmente o que o lead ouve ao atender. Precisa dizer que é um assistente de IA e
            que a ligação pode ser gravada — e precisa combinar com o que o prompt manda dizer.
            Use <code>{'{{leadName}}'}</code> para o nome de quem atendeu.
          </Ajuda>
        </div>

        <div className="mt-3">
          <Rotulo htmlFor="ag-prompt">Prompt de sistema</Rotulo>
          <AreaTexto
            id="ag-prompt"
            rows={22}
            className="font-mono text-[12px] leading-relaxed"
            value={f.prompt}
            disabled={travado}
            onChange={(e) => campo('prompt', e.target.value)}
          />
          <Ajuda>
            Tudo que o agente sabe e pode fazer. Ao salvar, avisamos se sumiu a divulgação de IA, o
            aviso de gravação ou o tratamento de opt-out — não bloqueamos, mas você fica sabendo.
          </Ajuda>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="ag-fim">Frase de encerramento</Rotulo>
            <Entrada
              id="ag-fim"
              value={f.mensagemEncerramento}
              disabled={travado}
              onChange={(e) => campo('mensagemEncerramento', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ag-vm">Mensagem na caixa postal</Rotulo>
            <Entrada
              id="ag-vm"
              value={f.mensagemCaixaPostal}
              disabled={travado}
              onChange={(e) => campo('mensagemCaixaPostal', e.target.value)}
            />
            <Ajuda>Deixada quando a detecção identifica secretária eletrônica.</Ajuda>
          </div>
        </div>
      </Cartao>

      <Cartao>
        <h3 className="text-sm font-semibold">Modelo e voz</h3>
        <p className="mt-1 text-xs text-[var(--color-tinta-3)]">
          Começou no padrão global. Mudar aqui vale só para este cliente.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="ag-mp">Provedor do modelo</Rotulo>
            <Entrada
              id="ag-mp"
              value={f.modeloProvedor}
              disabled={travado}
              onChange={(e) => campo('modeloProvedor', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ag-m">Modelo</Rotulo>
            <Entrada
              id="ag-m"
              value={f.modelo}
              disabled={travado}
              onChange={(e) => campo('modelo', e.target.value)}
            />
            <Ajuda>Muda custo e qualidade por minuto de ligação.</Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="ag-pv">Provedor de voz</Rotulo>
            <Entrada
              id="ag-pv"
              value={f.provedorVoz}
              disabled={travado}
              onChange={(e) => campo('provedorVoz', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ag-voz">Voz</Rotulo>
            <Entrada
              id="ag-voz"
              value={f.vozId}
              disabled={travado}
              onChange={(e) => campo('vozId', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ag-mv">Modelo de voz</Rotulo>
            <Entrada
              id="ag-mv"
              value={f.modeloVoz}
              disabled={travado}
              onChange={(e) => campo('modeloVoz', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ag-tr">Transcritor</Rotulo>
            <Entrada
              id="ag-tr"
              value={f.transcritor}
              disabled={travado}
              onChange={(e) => campo('transcritor', e.target.value)}
            />
          </div>
        </div>
      </Cartao>

      <Cartao>
        <h3 className="text-sm font-semibold">Número</h3>
        {numero ? (
          <p className="mt-2 text-sm">
            {numero}{' '}
            {vozIdNaVapi ? (
              <Selo tom="acento">importado na Vapi</Selo>
            ) : (
              <Selo tom="alerta">só no Twilio</Selo>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-tinta-2)]">
            Este cliente não tem número atribuído. Sem número, a ligação não sai.
          </p>
        )}

        {numero && !vozIdNaVapi && (
          <>
            <Ajuda>
              Comprar no Twilio não basta para voz: a Vapi identifica número por id próprio, e é
              esse id que o motor usa para ligar.
            </Ajuda>
            <div className="mt-2">
              <Botao
                variante="contorno"
                disabled={travado}
                onClick={() =>
                  iniciar(async () =>
                    mostrar(await aoImportarNumero(clienteId), 'número importado e ligado ao agente'),
                  )
                }
              >
                <Phone className="h-3.5 w-3.5" />
                Importar na Vapi
              </Botao>
            </div>
          </>
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
          {msg.tom !== 'ok' && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{msg.texto}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Botao
          variante="contorno"
          disabled={travado}
          onClick={() => iniciar(async () => mostrar(await aoSalvar(f), 'salvo'))}
        >
          Salvar
        </Botao>
        <Botao
          disabled={travado}
          onClick={() =>
            iniciar(async () => {
              // Publicar sem salvar publicaria o que está no banco, não o que
              // está na tela — a diferença mais fácil de não perceber.
              const s = await aoSalvar(f)
              if (!s.ok) return mostrar(s, '')
              mostrar(await aoPublicar(f.id), 'publicado na Vapi')
            })
          }
        >
          <CloudUpload className="h-3.5 w-3.5" />
          Salvar e publicar
        </Botao>
      </div>

      {!podeAdministrar && (
        <p className="text-xs text-[var(--color-tinta-3)]">
          Você pode ver, mas só quem administra altera o agente.
        </p>
      )}
    </div>
  )
}
