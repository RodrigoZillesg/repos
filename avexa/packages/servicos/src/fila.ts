import PgBoss from 'pg-boss'

/** Fila durável em Postgres, sem Redis.
 *
 *  Uma espera de três dias não é um timer na memória do processo: é uma linha no
 *  banco com hora de vencimento. O worker pode cair, subir de novo e o lead
 *  continua de onde parou. */

export const FILAS = {
  /** Dá o próximo passo de uma execução. */
  avancar: 'execucao.avancar',
  /** Processa um evento recebido de fornecedor. */
  evento: 'evento.receber',
  /** Reenvia um webhook de saída que falhou. */
  webhookSaida: 'webhook.saida',
  /** Põe (ou atualiza) a reunião do lead no CRM do cliente. */
  reuniaoCrm: 'crm.reuniao',
  /** Expurgo por retenção, uma vez por dia. */
  expurgo: 'retencao.expurgar',
} as const

export interface TrabalhoAvancar {
  execucaoId: string
}

export interface TrabalhoReuniaoCrm {
  leadId: string
}

export interface TrabalhoEvento {
  canal: string
  corpo: unknown
  cabecalhos: Record<string, string>
}

let instancia: PgBoss | undefined

export async function fila(url = process.env.DATABASE_URL): Promise<PgBoss> {
  if (!instancia) {
    if (!url) throw new Error('DATABASE_URL não definida')
    instancia = new PgBoss({ connectionString: url, schema: 'fila' })
    await instancia.start()
    for (const nome of Object.values(FILAS)) {
      await instancia.createQueue(nome)
    }
  }
  return instancia
}

/** Agenda o próximo passo de uma execução.
 *
 *  `chave` faz o pg-boss recusar um segundo trabalho pendente para a mesma
 *  execução: sem isso, um evento e um vencimento de espera chegando juntos
 *  fariam a execução avançar duas vezes e disparar dois contatos. */
export async function agendarAvanco(
  execucaoId: string,
  opcoes: { em?: Date } = {},
): Promise<string | null> {
  const b = await fila()
  return b.send(
    FILAS.avancar,
    { execucaoId } satisfies TrabalhoAvancar,
    {
      singletonKey: execucaoId,
      ...(opcoes.em ? { startAfter: opcoes.em } : {}),
      retryLimit: 5,
      retryBackoff: true,
      expireInMinutes: 15,
    },
  )
}

/** Agenda a subida da reunião ao CRM.
 *
 *  Pela fila, e não na resposta do webhook do fornecedor de agenda, por dois
 *  motivos: o Calendly desiste se a gente demorar, e um HubSpot fora do ar não
 *  pode custar a confirmação da reunião — que já está gravada aqui.
 *
 *  `chave` por lead: o lead que remarca duas vezes em um minuto vira uma
 *  subida só, com o estado final. */
export async function agendarReuniaoNoCrm(leadId: string): Promise<string | null> {
  const b = await fila()
  return b.send(
    FILAS.reuniaoCrm,
    { leadId } satisfies TrabalhoReuniaoCrm,
    { singletonKey: leadId, retryLimit: 5, retryBackoff: true, expireInMinutes: 15 },
  )
}

/** Agenda o expurgo diário.
 *
 *  Pelo cron do pg-boss, não por `setInterval`: o worker reinicia a cada deploy,
 *  e um temporizador na memória do processo reinicia junto — num dia com três
 *  deploys, o expurgo nunca chegaria a rodar. Às 3h UTC porque é madrugada em
 *  Sydney e em São Paulo ao mesmo tempo, e apagar meio milhão de linhas no meio
 *  do horário de contato disputa banco com o motor.
 *
 *  Chamar de novo com outro horário só reescreve o agendamento. */
export async function agendarExpurgoDiario(cron = '0 3 * * *'): Promise<void> {
  const b = await fila()
  await b.schedule(FILAS.expurgo, cron, {}, { singletonKey: 'expurgo', retryLimit: 2 })
}

export async function encerrarFila(): Promise<void> {
  if (instancia) {
    await instancia.stop({ graceful: true })
    instancia = undefined
  }
}
