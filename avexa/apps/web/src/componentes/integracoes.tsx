'use client'

import { useState, useTransition, type ReactNode } from 'react'
import {
  CalendarClock,
  CalendarDays,
  Contact,
  Link2Off,
  Mail,
  Sheet,
  TriangleAlert,
  Webhook,
} from 'lucide-react'
import type { ProvedorAgenda } from '@avexa/core'
import { podeAgendar, type AgendaDoGoogle } from '@avexa/adapters'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'

export interface EstadoCliente {
  clienteId: string
  provedorEscolhido: ProvedorAgenda | null
  googleConfigurado: boolean
  calendlyConfigurado: boolean
  calendar: {
    conectada: boolean
    calendarios: string[]
    /** Nome de cada agenda escolhida, como estava na hora de salvar. */
    nomes: Record<string, string>
    rodizio: boolean
  }
  calendly: {
    conectada: boolean
    tipoDeEvento: string | null
    tipoDeEventoNome: string | null
    tipoDeEventoDuracao: number | null
  }
  sheets: { conectada: boolean; planilhaId: string | null; aba: string | null }
  hubspotConfigurado: boolean
  hubspot: {
    conectada: boolean
    conta: string | null
    propriedadesOk: boolean
    statusDisponiveis: Array<{ valor: string; rotulo: string }>
    statusQualificado: string | null
    statusNaoQualificado: string | null
  }
  webhook: { url: string | null; temSegredo: boolean }
  emailTime: { para: string | null }
}

type Tipo = 'google_calendar' | 'google_sheets' | 'calendly' | 'hubspot' | 'webhook' | 'email_time'
/** Os que passam por consentimento OAuth — os outros são configuração nossa. */
type TipoConectavel = 'google_calendar' | 'google_sheets' | 'calendly' | 'hubspot'

interface Props {
  estado: EstadoCliente
  podeAdministrar: boolean
  aoDesligar: (clienteId: string, tipo: Tipo) => Promise<{ ok: boolean }>
  aoSalvarAgendas: (
    c: string,
    calendarios: string[],
    rodizio: boolean,
    nomes: Record<string, string>,
  ) => Promise<{ ok: boolean }>
  aoBuscarAgendas: (c: string) => Promise<{ agendas: AgendaDoGoogle[] } | { erro: string }>
  aoSalvarPlanilha: (c: string, planilhaId: string, aba: string) => Promise<{ ok: boolean }>
  aoSalvarTipoDeEvento: (
    c: string,
    uri: string,
    nome?: string,
    duracaoMin?: number,
  ) => Promise<{ ok: boolean }>
  aoBuscarTipos: (
    c: string,
  ) => Promise<{ tipos: Array<{ uri: string; nome: string; duracaoMin: number }> } | { erro: string }>
  aoEscolherProvedor: (c: string, p: ProvedorAgenda) => Promise<{ ok: boolean }>
  aoSalvarStatusHubspot: (c: string, qualificado: string, naoQualificado: string) => Promise<{ ok: boolean }>
  aoSalvarWebhook: (
    c: string,
    url: string,
    regerar: boolean,
  ) => Promise<{ ok: boolean; segredo?: string; erro?: string }>
  aoTestarWebhook: (c: string) => Promise<{ ok: boolean; status: number; erro?: string }>
  aoSalvarEmailTime: (c: string, para: string) => Promise<{ ok: boolean; erro?: string }>
}

function Conectar({
  clienteId,
  tipo,
  disponivel,
  rotulo,
}: {
  clienteId: string
  tipo: TipoConectavel
  disponivel: boolean
  rotulo: string
}) {
  return (
    <Botao comoFilho className="mt-4" {...(!disponivel ? { disabled: true } : {})}>
      <a href={`/api/integracoes/iniciar?cliente=${clienteId}&tipo=${tipo}`}>{rotulo}</a>
    </Botao>
  )
}

function SemCredencial({ o_que }: { o_que: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs text-[var(--color-alerta)]">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      Este ambiente não tem {o_que}, então não há como conectar nem guardar a autorização com
      segurança.
    </p>
  )
}

/** Escolha das agendas do time.
 *
 *  Era um campo de texto livre com um id por linha. O id de agenda é longo,
 *  ninguém sabe de cabeça, e digitar errado não dava erro nenhum: a integração
 *  ficava marcada como pronta e só falhava na hora de marcar, com o lead na
 *  linha. Aqui a lista vem da conta conectada, então o que dá para escolher é
 *  exatamente o que existe. */
function EscolhaDeAgendas({
  escolhidas,
  nomesSalvos,
  lista,
  manual,
  podeEditar,
  ocupado,
  aoAlternar,
  aoDigitarManual,
  aoCarregar,
}: {
  escolhidas: string[]
  nomesSalvos: Record<string, string>
  lista: AgendaDoGoogle[] | null
  manual: string
  podeEditar: boolean
  ocupado: boolean
  aoAlternar: (id: string) => void
  aoDigitarManual: (v: string) => void
  aoCarregar: () => void
}) {
  // Escolhidas que não vieram na lista: agenda removida da conta, ou acesso que
  // o dono retirou. Continuam visíveis para poderem ser desmarcadas — sumir com
  // elas deixaria o cliente com uma agenda configurada que ninguém enxerga.
  const orfas = lista ? escolhidas.filter((id) => !lista.some((a) => a.id === id)) : escolhidas

  const linha = (
    id: string,
    nome: string,
    marcada: boolean,
    detalhe: ReactNode,
    bloqueada: boolean,
  ) => (
    <label
      key={id}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
        bloqueada ? 'opacity-60' : 'cursor-pointer'
      } ${marcada ? 'border-[var(--color-acento)]' : ''}`}
    >
      <input
        type="checkbox"
        checked={marcada}
        disabled={!podeEditar || bloqueada}
        onChange={() => aoAlternar(id)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-acento)]"
      />
      <span className="min-w-0">
        <span className="block truncate">{nome}</span>
        <span className="block truncate font-mono text-[11px] text-[var(--color-tinta-3)]">
          {id}
        </span>
        {detalhe}
      </span>
    </label>
  )

  return (
    <div className="mt-4">
      <Rotulo htmlFor="cal-carregar">Agendas do time</Rotulo>

      <div className="grid gap-1.5">
        {lista?.map((a) => {
          const marcada = escolhidas.includes(a.id)
          // Só de leitura não pode receber evento. Fica listada e desmarcável
          // — o operador precisa ver que ela existe e por que não serve.
          const bloqueada = !podeAgendar(a.acesso) && !marcada
          return linha(
            a.id,
            a.nome,
            marcada,
            <span className="mt-0.5 flex flex-wrap gap-1">
              {a.principal && <Selo>principal</Selo>}
              {!podeAgendar(a.acesso) && (
                <Selo tom="alerta">só leitura — peça acesso de escrita ao dono</Selo>
              )}
            </span>,
            bloqueada,
          )
        })}

        {orfas.map((id) =>
          linha(
            id,
            nomesSalvos[id] ?? id,
            true,
            lista ? (
              <span className="mt-0.5 block">
                <Selo tom="alerta">não aparece nesta conta</Selo>
              </span>
            ) : null,
            false,
          ),
        )}

        {lista === null && escolhidas.length === 0 && (
          <p className="text-[13px] text-[var(--color-tinta-3)]">
            Nenhuma agenda escolhida ainda.
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Botao
          id="cal-carregar"
          variante="contorno"
          tamanho="pequeno"
          disabled={!podeEditar || ocupado}
          onClick={aoCarregar}
        >
          {lista === null ? 'Carregar agendas do Google' : 'Recarregar'}
        </Botao>
      </div>

      <div className="mt-3">
        <Rotulo htmlFor="cal-manual">Agenda que não está na lista</Rotulo>
        <div className="flex gap-2">
          <Entrada
            id="cal-manual"
            value={manual}
            disabled={!podeEditar}
            onChange={(ev) => aoDigitarManual(ev.target.value)}
            placeholder="ana@cliente.com"
            className="font-mono text-xs"
          />
          <Botao
            variante="contorno"
            tamanho="pequeno"
            disabled={!podeEditar || !manual.trim() || escolhidas.includes(manual.trim())}
            onClick={() => {
              aoAlternar(manual.trim())
              aoDigitarManual('')
            }}
          >
            Adicionar
          </Botao>
        </div>
        <Ajuda>
          Uma agenda compartilhada com a conta conectada mas não adicionada à lista dela não
          aparece acima. Nesse caso o e-mail entra aqui — e só funciona se o dono tiver dado
          permissão para alterar eventos.
        </Ajuda>
      </div>
    </div>
  )
}

export function Integracoes(p: Props) {
  const { estado: e } = p
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const [agendas, setAgendas] = useState<string[]>(e.calendar.calendarios)
  const [listaAgendas, setListaAgendas] = useState<AgendaDoGoogle[] | null>(null)
  const [agendaManual, setAgendaManual] = useState('')
  const [rodizio, setRodizio] = useState(e.calendar.rodizio)
  const [planilha, setPlanilha] = useState(e.sheets.planilhaId ?? '')
  const [aba, setAba] = useState(e.sheets.aba ?? 'Leads')
  const [tipos, setTipos] = useState<Array<{ uri: string; nome: string; duracaoMin: number }>>([])
  const [tipoEscolhido, setTipoEscolhido] = useState(e.calendly.tipoDeEvento ?? '')
  const [statusQual, setStatusQual] = useState(e.hubspot.statusQualificado ?? '')
  const [statusNao, setStatusNao] = useState(e.hubspot.statusNaoQualificado ?? '')
  const [urlWebhook, setUrlWebhook] = useState(e.webhook.url ?? '')
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null)
  const [emailTime, setEmailTime] = useState(e.emailTime.para ?? '')

  const duasAgendas = e.calendar.conectada && e.calendly.conectada
  const ativo: ProvedorAgenda | null = e.provedorEscolhido
    ? e.provedorEscolhido
    : e.calendly.conectada
      ? 'calendly'
      : e.calendar.conectada
        ? 'google_calendar'
        : null

  const rodar = (f: () => Promise<{ ok: boolean }>, ok: string) =>
    iniciar(async () => {
      const r = await f()
      setAviso(r.ok ? ok : 'Não foi possível salvar.')
    })

  return (
    <div className="space-y-4">
      {duasAgendas && (
        <Cartao>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock size={15} />
            <h3 className="text-sm font-semibold">Ferramenta de agenda deste cliente</h3>
          </div>
          <Ajuda>
            As duas estão conectadas. O nó “Agendar reunião” usa a escolhida aqui — o fluxo não
            muda, só quem marca.
          </Ajuda>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['google_calendar', 'calendly'] as const).map((prov) => (
              <Botao
                key={prov}
                variante={ativo === prov ? 'padrao' : 'contorno'}
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() => rodar(() => p.aoEscolherProvedor(e.clienteId, prov), 'Escolhido.')}
              >
                {prov === 'calendly' ? 'Calendly' : 'Google Calendar'}
              </Botao>
            ))}
          </div>
        </Cartao>
      )}

      {/* ---------------------------- Google Calendar --------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays size={15} />
          <h3 className="text-sm font-semibold">Google Calendar</h3>
          {!e.calendar.conectada ? (
            <Selo>não conectado</Selo>
          ) : e.calendar.calendarios.length === 0 ? (
            <Selo tom="alerta">conectado, falta escolher a agenda</Selo>
          ) : ativo === 'google_calendar' ? (
            <Selo tom="ok">em uso</Selo>
          ) : (
            <Selo>pronto, mas o cliente usa Calendly</Selo>
          )}
        </div>
        <Ajuda>
          Marca direto: escolhemos um horário livre na janela do lead, criamos o evento e
          convidamos. Exige acesso de escrita à agenda do time.
        </Ajuda>

        {!e.googleConfigurado && <SemCredencial o_que="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e APP_SECRET" />}

        {!e.calendar.conectada ? (
          <Conectar
            clienteId={e.clienteId}
            tipo="google_calendar"
            disponivel={p.podeAdministrar && e.googleConfigurado}
            rotulo="Conectar Google Calendar"
          />
        ) : (
          <>
            <EscolhaDeAgendas
              escolhidas={agendas}
              nomesSalvos={e.calendar.nomes}
              lista={listaAgendas}
              manual={agendaManual}
              podeEditar={p.podeAdministrar}
              ocupado={pendente}
              aoAlternar={(id) =>
                setAgendas((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
              }
              aoDigitarManual={setAgendaManual}
              aoCarregar={() =>
                iniciar(async () => {
                  const r = await p.aoBuscarAgendas(e.clienteId)
                  if ('erro' in r) setAviso(r.erro)
                  else {
                    setListaAgendas(r.agendas)
                    setAviso(`${r.agendas.length} agenda(s) nesta conta.`)
                  }
                })
              }
            />
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={rodizio}
                disabled={!p.podeAdministrar}
                onChange={(ev) => setRodizio(ev.target.checked)}
                className="h-4 w-4 accent-[var(--color-acento)]"
              />
              Rodízio entre consultores
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Botao
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() =>
                  rodar(
                    () =>
                      p.aoSalvarAgendas(e.clienteId, agendas, rodizio, {
                        ...e.calendar.nomes,
                        ...Object.fromEntries((listaAgendas ?? []).map((a) => [a.id, a.nome])),
                      }),
                    'Salvo.',
                  )
                }
              >
                Salvar
              </Botao>
              <Botao
                variante="perigo"
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() => rodar(() => p.aoDesligar(e.clienteId, 'google_calendar'), 'Desconectado, e o acesso foi revogado na conta Google.')}
              >
                <Link2Off size={12} /> Desconectar
              </Botao>
            </div>
          </>
        )}
      </Cartao>

      {/* -------------------------------- Calendly ------------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock size={15} />
          <h3 className="text-sm font-semibold">Calendly</h3>
          {!e.calendly.conectada ? (
            <Selo>não conectado</Selo>
          ) : !e.calendly.tipoDeEvento ? (
            <Selo tom="alerta">conectado, falta escolher o tipo de evento</Selo>
          ) : ativo === 'calendly' ? (
            <Selo tom="ok">em uso</Selo>
          ) : (
            <Selo>pronto, mas o cliente usa o Google</Selo>
          )}
        </div>
        <Ajuda>
          Entrega um link de uso único e quem escolhe o horário é o lead — o Calendly não deixa
          marcar na agenda de terceiros pela API, de propósito. A reunião passa a existir quando o
          webhook avisa que ele marcou.
        </Ajuda>

        {!e.calendlyConfigurado && <SemCredencial o_que="CALENDLY_CLIENT_ID, CALENDLY_CLIENT_SECRET e APP_SECRET" />}

        {!e.calendly.conectada ? (
          <Conectar
            clienteId={e.clienteId}
            tipo="calendly"
            disponivel={p.podeAdministrar && e.calendlyConfigurado}
            rotulo="Conectar Calendly"
          />
        ) : (
          <>
            <div className="mt-4">
              <Rotulo htmlFor="tipoev">Tipo de evento</Rotulo>
              <div className="flex gap-2">
                <Selecao
                  id="tipoev"
                  value={tipoEscolhido}
                  disabled={!p.podeAdministrar}
                  onChange={(ev) => setTipoEscolhido(ev.target.value)}
                >
                  <option value="">
                    {tipos.length === 0 ? '— carregue a lista —' : '— escolha —'}
                  </option>
                  {tipos.map((t) => (
                    <option key={t.uri} value={t.uri}>
                      {t.nome} · {t.duracaoMin} min
                    </option>
                  ))}
                  {tipoEscolhido && !tipos.some((t) => t.uri === tipoEscolhido) && (
                    <option value={tipoEscolhido}>
                      {e.calendly.tipoDeEventoNome
                        ? `${e.calendly.tipoDeEventoNome}${e.calendly.tipoDeEventoDuracao ? ` · ${e.calendly.tipoDeEventoDuracao} min` : ''}`
                        : '(escolhido antes)'}
                    </option>
                  )}
                </Selecao>
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  disabled={!p.podeAdministrar || pendente}
                  onClick={() =>
                    iniciar(async () => {
                      const r = await p.aoBuscarTipos(e.clienteId)
                      if ('erro' in r) setAviso(r.erro)
                      else {
                        setTipos(r.tipos)
                        setAviso(`${r.tipos.length} tipo(s) de evento.`)
                      }
                    })
                  }
                >
                  Carregar do Calendly
                </Botao>
              </div>
              <Ajuda>
                É este tipo de evento que define a duração e a disponibilidade oferecidas ao lead —
                a configuração vive no Calendly do cliente, não aqui.
              </Ajuda>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Botao
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente || !tipoEscolhido}
                onClick={() => {
                  const t = tipos.find((x) => x.uri === tipoEscolhido)
                  rodar(
                    () => p.aoSalvarTipoDeEvento(e.clienteId, tipoEscolhido, t?.nome, t?.duracaoMin),
                    'Salvo.',
                  )
                }}
              >
                Salvar
              </Botao>
              <Botao
                variante="perigo"
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() => rodar(() => p.aoDesligar(e.clienteId, 'calendly'), 'Desconectado. Remova também o acesso do Avexa em Integrations, na conta Calendly.')}
              >
                <Link2Off size={12} /> Desconectar
              </Botao>
            </div>
          </>
        )}
      </Cartao>

      {/* ------------------------------ Google Sheets ---------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Sheet size={15} />
          <h3 className="text-sm font-semibold">Google Sheets</h3>
          {!e.sheets.conectada ? (
            <Selo>não conectado</Selo>
          ) : e.sheets.planilhaId ? (
            <Selo tom="ok">pronto</Selo>
          ) : (
            <Selo tom="alerta">conectado, falta escolher a planilha</Selo>
          )}
        </div>
        <Ajuda>O destino “Planilha compartilhada” escreve uma linha por lead qualificado.</Ajuda>

        {!e.googleConfigurado && <SemCredencial o_que="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e APP_SECRET" />}

        {!e.sheets.conectada ? (
          <Conectar
            clienteId={e.clienteId}
            tipo="google_sheets"
            disponivel={p.podeAdministrar && e.googleConfigurado}
            rotulo="Conectar Google Sheets"
          />
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px]">
              <div>
                <Rotulo htmlFor="plan">Planilha</Rotulo>
                <Entrada
                  id="plan"
                  value={planilha}
                  disabled={!p.podeAdministrar}
                  onChange={(ev) => setPlanilha(ev.target.value)}
                  placeholder="cole a URL da planilha"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Rotulo htmlFor="aba">Aba</Rotulo>
                <Entrada
                  id="aba"
                  value={aba}
                  disabled={!p.podeAdministrar}
                  onChange={(ev) => setAba(ev.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Botao
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() => rodar(() => p.aoSalvarPlanilha(e.clienteId, planilha, aba), 'Salvo.')}
              >
                Salvar
              </Botao>
              <Botao
                variante="perigo"
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() => rodar(() => p.aoDesligar(e.clienteId, 'google_sheets'), 'Desconectado.')}
              >
                <Link2Off size={12} /> Desconectar
              </Botao>
            </div>
          </>
        )}
      </Cartao>


      {/* -------------------------------- HubSpot -------------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Contact size={15} />
          <h3 className="text-sm font-semibold">HubSpot</h3>
          {!e.hubspot.conectada ? (
            <Selo>não conectado</Selo>
          ) : !e.hubspot.propriedadesOk ? (
            <Selo tom="alerta">conectado, sem as propriedades da Avexa</Selo>
          ) : (
            <Selo tom="ok">{e.hubspot.conta ? `portal ${e.hubspot.conta}` : 'pronto'}</Selo>
          )}
        </div>
        <Ajuda>
          O destino “CRM do cliente” grava o contato com score, resumo e etiquetas, deixa a conversa
          como nota e põe a reunião marcada na agenda do vendedor. Contato e reunião são
          atualizados, nunca duplicados: o mesmo lead volta por reenvio, e quem cancela pelo link
          mexe na reunião que já está lá.
        </Ajuda>

        {!e.hubspotConfigurado && (
          <SemCredencial o_que="HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET e APP_SECRET" />
        )}

        {!e.hubspot.conectada ? (
          <Conectar
            clienteId={e.clienteId}
            tipo="hubspot"
            disponivel={p.podeAdministrar && e.hubspotConfigurado}
            rotulo="Conectar HubSpot"
          />
        ) : (
          <>
            {!e.hubspot.propriedadesOk && (
              <p className="mt-3 flex items-start gap-2 text-xs text-[var(--color-alerta)]">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                As propriedades <code>avexa_score</code> e <code>avexa_resumo</code> não existem
                neste portal. O contato é gravado sem elas. Reconecte depois de liberar o escopo de
                esquema de contatos.
              </p>
            )}

            {e.hubspot.statusDisponiveis.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Rotulo htmlFor="stq">Status quando qualificado</Rotulo>
                  <Selecao
                    id="stq"
                    value={statusQual}
                    disabled={!p.podeAdministrar}
                    onChange={(ev) => setStatusQual(ev.target.value)}
                  >
                    <option value="">— não mexer no status —</option>
                    {e.hubspot.statusDisponiveis.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </Selecao>
                </div>
                <div>
                  <Rotulo htmlFor="stn">Status quando não qualificado</Rotulo>
                  <Selecao
                    id="stn"
                    value={statusNao}
                    disabled={!p.podeAdministrar}
                    onChange={(ev) => setStatusNao(ev.target.value)}
                  >
                    <option value="">— não mexer no status —</option>
                    {e.hubspot.statusDisponiveis.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </Selecao>
                </div>
              </div>
            ) : (
              <Ajuda>
                Não deu para ler os status de lead deste portal, então a Avexa não mexe nesse campo.
              </Ajuda>
            )}
            <Ajuda>
              As opções vêm do portal do cliente, não de uma lista nossa: cada empresa renomeia esse
              campo, e mandar um valor que o portal não tem derruba a entrega inteira.
            </Ajuda>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Botao
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() =>
                  rodar(() => p.aoSalvarStatusHubspot(e.clienteId, statusQual, statusNao), 'Salvo.')
                }
              >
                Salvar
              </Botao>
              <Botao
                variante="perigo"
                tamanho="pequeno"
                disabled={!p.podeAdministrar || pendente}
                onClick={() =>
                  rodar(
                    () => p.aoDesligar(e.clienteId, 'hubspot'),
                    'Desconectado. Remova também o app da Avexa em Integrações, na conta HubSpot.',
                  )
                }
              >
                <Link2Off size={12} /> Desconectar
              </Botao>
            </div>
          </>
        )}
      </Cartao>

      {/* --------------------------- Webhook do cliente -------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Webhook size={15} />
          <h3 className="text-sm font-semibold">Webhook do cliente</h3>
          {!e.webhook.url ? (
            <Selo>não configurado</Selo>
          ) : e.webhook.temSegredo ? (
            <Selo tom="ok">assinando</Selo>
          ) : (
            <Selo tom="alerta">sem segredo de assinatura</Selo>
          )}
        </div>
        <Ajuda>
          Para onde vai o destino “Webhook do cliente” e também o nó de webhook do meio do fluxo.
          Cada envio leva assinatura e um id de entrega: sem assinatura, quem descobrir a URL
          inventa lead na base do cliente; sem id, um reenvio vira lead duplicado.
        </Ajuda>

        <div className="mt-4">
          <Rotulo htmlFor="whurl">URL</Rotulo>
          <Entrada
            id="whurl"
            value={urlWebhook}
            disabled={!p.podeAdministrar}
            onChange={(ev) => setUrlWebhook(ev.target.value)}
            placeholder="https://sistema-do-cliente.com/avexa"
            className="font-mono text-xs"
          />
          <Ajuda>Só https: a carga leva nome, telefone e e-mail do lead.</Ajuda>
        </div>

        {segredoNovo && (
          <div className="mt-3 rounded-[var(--radius-cartao)] border border-[var(--color-ok)] p-3">
            <p className="text-xs font-medium">Segredo de assinatura — copie agora</p>
            <code className="mt-1 block break-all font-mono text-xs">{segredoNovo}</code>
            <p className="mt-1.5 text-xs text-[var(--color-tinta-2)]">
              Guardamos cifrado e não mostramos de novo. O cliente confere assim:{' '}
              <code>HMAC-SHA256(&quot;&lt;t&gt;.&lt;corpo cru&gt;&quot;)</code> contra o cabeçalho{' '}
              <code>x-avexa-assinatura</code>.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Botao
            tamanho="pequeno"
            disabled={!p.podeAdministrar || pendente || !urlWebhook}
            onClick={() =>
              iniciar(async () => {
                const r = await p.aoSalvarWebhook(e.clienteId, urlWebhook, false)
                setSegredoNovo(r.segredo ?? null)
                setAviso(r.ok ? 'Salvo.' : (r.erro ?? 'Não foi possível salvar.'))
              })
            }
          >
            Salvar
          </Botao>
          <Botao
            variante="contorno"
            tamanho="pequeno"
            disabled={!p.podeAdministrar || pendente || !e.webhook.url}
            onClick={() =>
              iniciar(async () => {
                const r = await p.aoTestarWebhook(e.clienteId)
                setAviso(
                  r.ok
                    ? `O endpoint respondeu ${r.status}. A assinatura que ele recebeu é a mesma dos leads de verdade.`
                    : `Falhou: ${r.erro ?? `HTTP ${r.status}`}`,
                )
              })
            }
          >
            Mandar um lead de teste
          </Botao>
          <Botao
            variante="contorno"
            tamanho="pequeno"
            disabled={!p.podeAdministrar || pendente || !e.webhook.url}
            onClick={() =>
              iniciar(async () => {
                const r = await p.aoSalvarWebhook(e.clienteId, urlWebhook, true)
                setSegredoNovo(r.segredo ?? null)
                setAviso(
                  r.ok
                    ? 'Segredo trocado. O anterior parou de valer agora.'
                    : (r.erro ?? 'Não foi possível trocar.'),
                )
              })
            }
          >
            Trocar o segredo
          </Botao>
          {e.webhook.url && (
            <Botao
              variante="perigo"
              tamanho="pequeno"
              disabled={!p.podeAdministrar || pendente}
              onClick={() => rodar(() => p.aoDesligar(e.clienteId, 'webhook'), 'Removido.')}
            >
              <Link2Off size={12} /> Remover
            </Botao>
          )}
        </div>
      </Cartao>

      {/* ----------------------------- E-mail do time ---------------------------- */}
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <Mail size={15} />
          <h3 className="text-sm font-semibold">E-mail do time</h3>
          {e.emailTime.para ? <Selo tom="ok">pronto</Selo> : <Selo>não configurado</Selo>}
        </div>
        <Ajuda>
          O destino mais simples, e o que mais salva ativação: um aviso com score, resumo e reunião
          marcada para quem vai ligar.
        </Ajuda>
        <div className="mt-4">
          <Rotulo htmlFor="mailtime">Para</Rotulo>
          <Entrada
            id="mailtime"
            value={emailTime}
            disabled={!p.podeAdministrar}
            onChange={(ev) => setEmailTime(ev.target.value)}
            placeholder="comercial@cliente.com"
            className="font-mono text-xs"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Botao
            tamanho="pequeno"
            disabled={!p.podeAdministrar || pendente || !emailTime}
            onClick={() =>
              iniciar(async () => {
                const r = await p.aoSalvarEmailTime(e.clienteId, emailTime)
                setAviso(r.ok ? 'Salvo.' : (r.erro ?? 'Não foi possível salvar.'))
              })
            }
          >
            Salvar
          </Botao>
          {e.emailTime.para && (
            <Botao
              variante="perigo"
              tamanho="pequeno"
              disabled={!p.podeAdministrar || pendente}
              onClick={() => rodar(() => p.aoDesligar(e.clienteId, 'email_time'), 'Removido.')}
            >
              <Link2Off size={12} /> Remover
            </Botao>
          )}
        </div>
      </Cartao>

      {aviso && <p className="text-xs text-[var(--color-tinta-2)]">{aviso}</p>}
    </div>
  )
}
