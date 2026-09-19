'use client'

import { useState, useTransition } from 'react'
import { CalendarDays, Link2Off, Sheet, TriangleAlert } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, AreaTexto, Entrada, Rotulo } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'

export interface EstadoIntegracao {
  clienteId: string
  tipo: 'google_calendar' | 'google_sheets'
  conectada: boolean
  conta?: string | undefined
  calendarios?: string[] | undefined
  planilhaId?: string | undefined
  aba?: string | undefined
}

interface Props {
  estado: EstadoIntegracao
  podeAdministrar: boolean
  googleConfigurado: boolean
  aoDesligar: (clienteId: string, tipo: EstadoIntegracao['tipo']) => Promise<{ ok: boolean }>
  aoSalvarAgendas: (clienteId: string, calendarios: string) => Promise<{ ok: boolean }>
  aoSalvarPlanilha: (clienteId: string, planilhaId: string, aba: string) => Promise<{ ok: boolean }>
}

/** Cartão de uma integração Google.
 *
 *  Conectada não é o mesmo que pronta: uma agenda conectada sem calendário
 *  escolhido não agenda nada, e o cartão diz isso em vez de mostrar um selo
 *  verde que mente. */
export function IntegracaoGoogle(p: Props) {
  const { estado } = p
  const calendario = estado.tipo === 'google_calendar'

  const [agendas, setAgendas] = useState((estado.calendarios ?? []).join('\n'))
  const [planilha, setPlanilha] = useState(estado.planilhaId ?? '')
  const [aba, setAba] = useState(estado.aba ?? 'Leads')
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const configurada = calendario
    ? (estado.calendarios?.length ?? 0) > 0
    : Boolean(estado.planilhaId)

  return (
    <Cartao>
      <div className="flex flex-wrap items-center gap-2">
        {calendario ? <CalendarDays size={15} /> : <Sheet size={15} />}
        <h3 className="text-sm font-semibold">
          {calendario ? 'Google Calendar' : 'Google Sheets'}
        </h3>
        {!estado.conectada ? (
          <Selo>não conectado</Selo>
        ) : configurada ? (
          <Selo tom="ok">pronto</Selo>
        ) : (
          <Selo tom="alerta">conectado, falta escolher o destino</Selo>
        )}
      </div>

      <Ajuda>
        {calendario
          ? 'O nó “Agendar reunião” oferece horários livres da agenda do time e cria o evento com o lead convidado.'
          : 'O destino “Planilha compartilhada” escreve uma linha por lead qualificado.'}
      </Ajuda>

      {!p.googleConfigurado && (
        <p className="mt-3 flex items-start gap-2 text-xs text-[var(--color-alerta)]">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          Este ambiente não tem GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e APP_SECRET, então não há como conectar nem guardar a autorização com segurança.
        </p>
      )}

      {!estado.conectada ? (
        <Botao
          comoFilho
          className="mt-4"
          {...(!p.podeAdministrar || !p.googleConfigurado ? { disabled: true } : {})}
        >
          <a href={`/api/integracoes/google/iniciar?cliente=${estado.clienteId}&tipo=${estado.tipo}`}>
            Conectar conta Google
          </a>
        </Botao>
      ) : (
        <>
          {calendario ? (
            <div className="mt-4">
              <Rotulo htmlFor={`cal-${estado.clienteId}`}>Agendas do time</Rotulo>
              <AreaTexto
                id={`cal-${estado.clienteId}`}
                rows={3}
                value={agendas}
                disabled={!p.podeAdministrar}
                onChange={(e) => setAgendas(e.target.value)}
                placeholder={'ana@cliente.com\nbruno@cliente.com'}
                className="font-mono text-xs"
              />
              <Ajuda>
                Um e-mail por linha, na ordem do rodízio. Cada consultor precisa ter compartilhado a
                agenda com a conta conectada — quem não compartilhou fica de fora do rodízio em vez
                de entrar como se estivesse livre.
              </Ajuda>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px]">
              <div>
                <Rotulo htmlFor={`plan-${estado.clienteId}`}>Planilha</Rotulo>
                <Entrada
                  id={`plan-${estado.clienteId}`}
                  value={planilha}
                  disabled={!p.podeAdministrar}
                  onChange={(e) => setPlanilha(e.target.value)}
                  placeholder="cole a URL da planilha"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Rotulo htmlFor={`aba-${estado.clienteId}`}>Aba</Rotulo>
                <Entrada
                  id={`aba-${estado.clienteId}`}
                  value={aba}
                  disabled={!p.podeAdministrar}
                  onChange={(e) => setAba(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Botao
              tamanho="pequeno"
              disabled={!p.podeAdministrar || pendente}
              onClick={() =>
                iniciar(async () => {
                  const r = calendario
                    ? await p.aoSalvarAgendas(estado.clienteId, agendas)
                    : await p.aoSalvarPlanilha(estado.clienteId, planilha, aba)
                  setAviso(r.ok ? 'Salvo.' : 'Não foi possível salvar.')
                })
              }
            >
              Salvar destino
            </Botao>
            <Botao
              variante="perigo"
              tamanho="pequeno"
              disabled={!p.podeAdministrar || pendente}
              onClick={() =>
                iniciar(async () => {
                  await p.aoDesligar(estado.clienteId, estado.tipo)
                  setAviso('Desconectado, e o acesso foi revogado na conta Google.')
                })
              }
            >
              <Link2Off size={12} />
              Desconectar
            </Botao>
            {aviso && <span className="text-xs text-[var(--color-tinta-2)]">{aviso}</span>}
          </div>
        </>
      )}
    </Cartao>
  )
}
