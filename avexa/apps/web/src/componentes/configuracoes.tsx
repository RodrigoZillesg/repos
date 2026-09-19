'use client'

import { useState, useTransition } from 'react'
import { Gauge, ShieldAlert, Trash2 } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Rotulo } from '@/componentes/ui/campo'
import { Cartao } from '@/componentes/ui/cartao'
import type { Ajustes } from '@/app/(painel)/configuracoes/acoes'

/** Minutos desde a meia-noite <-> HH:MM, que é como gente pensa em horário. */
const paraHora = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const paraMinutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

interface Props {
  inicial: Ajustes
  podeAdministrar: boolean
  aoSalvar: (a: Ajustes) => Promise<{ ok: boolean; erro?: string }>
}

export function Configuracoes({ inicial, podeAdministrar, aoSalvar }: Props) {
  const [a, setA] = useState<Ajustes>(inicial)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const campo = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => setA((x) => ({ ...x, [k]: v }))
  const travado = !podeAdministrar || pendente

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Gauge size={15} />
          <h3 className="text-sm font-semibold">Limites do motor</h3>
        </div>
        <Ajuda>
          Teto, não padrão: um fluxo pode pedir menos que estes valores, nunca mais. É o que
          impede um fluxo mal desenhado de virar perseguição na vida de alguém.
        </Ajuda>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="teto">Tentativas por lead, no máximo</Rotulo>
            <Entrada
              id="teto"
              type="number"
              min={1}
              max={20}
              value={a.tetoTentativas}
              disabled={travado}
              onChange={(e) => campo('tetoTentativas', Number(e.target.value))}
            />
          </div>
          <div>
            <Rotulo htmlFor="intervalo">Intervalo mínimo entre contatos (min)</Rotulo>
            <Entrada
              id="intervalo"
              type="number"
              min={5}
              value={a.intervaloMinimoMin}
              disabled={travado}
              onChange={(e) => campo('intervaloMinimoMin', Number(e.target.value))}
            />
            <Ajuda>Sustenta a regra de um canal por janela.</Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="ini">Janela de contato: início</Rotulo>
            <Entrada
              id="ini"
              type="time"
              value={paraHora(a.janelaInicioMin)}
              disabled={travado}
              onChange={(e) => campo('janelaInicioMin', paraMinutos(e.target.value))}
            />
          </div>
          <div>
            <Rotulo htmlFor="fim">Janela de contato: fim</Rotulo>
            <Entrada
              id="fim"
              type="time"
              value={paraHora(a.janelaFimMin)}
              disabled={travado}
              onChange={(e) => campo('janelaFimMin', paraMinutos(e.target.value))}
            />
            <Ajuda>No fuso do lead, sempre — não no seu.</Ajuda>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              ['contatarSabado', 'Contatar aos sábados'],
              ['contatarDomingo', 'Contatar aos domingos'],
            ] as const
          ).map(([k, rotulo]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={a[k]}
                disabled={travado}
                onChange={(e) => campo(k, e.target.checked)}
                className="h-4 w-4 accent-[var(--color-acento)]"
              />
              {rotulo}
            </label>
          ))}
        </div>

        <div className="mt-4">
          <Rotulo htmlFor="prof">Profundidade máxima de subfluxo</Rotulo>
          <Entrada
            id="prof"
            type="number"
            min={1}
            max={10}
            value={a.profundidadeMaxSubfluxo}
            disabled={travado}
            className="max-w-28"
            onChange={(e) => campo('profundidadeMaxSubfluxo', Number(e.target.value))}
          />
          <Ajuda>Um fluxo pode chamar outro; o motor corta a cadeia neste ponto.</Ajuda>
        </div>
      </Cartao>

      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Trash2 size={15} />
          <h3 className="text-sm font-semibold">Retenção de dados</h3>
        </div>
        <Ajuda>
          Zero significa guardar para sempre. Com um prazo, o expurgo roda toda madrugada e
          apaga o que passou dele — lead em andamento espera o fluxo terminar.
        </Ajuda>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="retLead">Apagar leads depois de (dias)</Rotulo>
            <Entrada
              id="retLead"
              type="number"
              min={0}
              value={a.retencaoLeadDias}
              disabled={travado}
              onChange={(e) => campo('retencaoLeadDias', Number(e.target.value))}
            />
            <Ajuda>
              Apaga o lead e tudo que veio com ele: tentativas, entregas, reuniões, mensagens.
            </Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="retGrav">Apagar gravações depois de (dias)</Rotulo>
            <Entrada
              id="retGrav"
              type="number"
              min={0}
              value={a.retencaoGravacaoDias}
              disabled={travado}
              onChange={(e) => campo('retencaoGravacaoDias', Number(e.target.value))}
            />
            <Ajuda>
              Sai o áudio e a transcrição; ficam duração, se atendeu e se o aviso de gravação foi
              emitido — a prova de que a ligação aconteceu do jeito certo.
            </Ajuda>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-cartao)] border border-[var(--color-alerta)] p-3 text-xs leading-relaxed text-[var(--color-tinta-2)]">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--color-alerta)]" />
          <span>
            Duas coisas que o expurgo <strong>não</strong> faz, e que é melhor saber antes:
            <br />
            <strong>A supressão nunca é apagada.</strong> Quem pediu para parar continua bloqueado
            depois que o lead dele sair daqui — o contrário transformaria o expurgo em permissão
            para contatar de novo.
            <br />
            <strong>O áudio no fornecedor não some.</strong> Apagamos a nossa cópia do endereço e a
            transcrição; o arquivo em si vive na conta de voz e obedece à política de retenção de
            lá. Ajuste também por lá se o prazo tiver de valer de verdade.
          </span>
        </p>
      </Cartao>

      <div className="flex flex-wrap items-center gap-3">
        <Botao
          disabled={travado}
          onClick={() =>
            iniciar(async () => {
              const r = await aoSalvar(a)
              setAviso(r.ok ? 'Salvo. Vale para o próximo contato de cada fluxo.' : (r.erro ?? 'Não foi possível salvar.'))
            })
          }
        >
          Salvar
        </Botao>
        {aviso && <span className="text-xs text-[var(--color-tinta-2)]">{aviso}</span>}
        {!podeAdministrar && (
          <span className="text-xs text-[var(--color-tinta-3)]">
            Só administrador altera estes valores.
          </span>
        )}
      </div>
    </div>
  )
}
