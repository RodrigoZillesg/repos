import type { NumeroDaConta } from '@avexa/adapters'

/** Cruzar o que o Twilio tem com o que a Avexa acha que tem.
 *
 *  As duas listas divergem de três jeitos, e os três importam:
 *
 *  - número no Twilio que a Avexa não conhece: é da operação antiga, e o
 *    apelido é a única pista de quem é o dono;
 *  - número na Avexa que não existe no Twilio: o cliente aparece com número
 *    atribuído, o canal de SMS liga porque o pré-requisito "tem número" está
 *    satisfeito, e o envio morre lá no fim com um 400. Foi o que aconteceu com
 *    os quatro números do seed;
 *  - número nos dois, com apelido diferente do dono registrado aqui: alguém
 *    renomeou de um lado só.
 *
 *  A parte que decide isso é função pura para poder ser testada sem conta no
 *  Twilio: é justamente o caso em que errar é caro e silencioso. */

export type OrigemNumero = 'avexa' | 'fora' | 'sumido'

export interface DonoDoNumero {
  e164: string
  provedorSid: string | null
  status: string
  clienteId: string | null
  clienteNome: string | null
  projetoId: string | null
  projetoNome: string | null
}

export interface NumeroInventariado {
  /** Nulo só quando o número existe na Avexa e não no Twilio. */
  sid: string | null
  e164: string
  apelido: string
  capacidades: string[]
  webhookSms: string | null
  origem: OrigemNumero
  clienteId: string | null
  clienteNome: string | null
  projetoId: string | null
  projetoNome: string | null
  /** Status na nossa tabela: livre, atribuido... Nulo para número de fora. */
  status: string | null
  /** Como o número deveria se chamar, dado o dono registrado aqui. Nulo quando
   *  não há dono para sugerir nome. */
  apelidoSugerido: string | null
  /** O nome no Twilio não é o sugerido. Não é erro — pode ter sido ajustado à
   *  mão —, mas é a diferença que a tela precisa mostrar. */
  foraDoPadrao: boolean
}

/** Limite do FriendlyName no Twilio. Acima disso ele corta sem avisar. */
export const LIMITE_APELIDO = 64
const SEPARADOR = ' · '

/** O nome de um número: cliente e projeto, nessa ordem.
 *
 *  A ordem não é estética. A lista do console do Twilio ordena por nome, então
 *  cliente na frente agrupa os números do mesmo cliente — que é como se procura
 *  quando alguém pergunta "qual número é o da escola tal?".
 *
 *  Quando não cabe em 64, encurta os dois lados em vez de cortar o fim: cortar
 *  o fim apagaria justamente o projeto, que é o que distingue um número do
 *  outro dentro do mesmo cliente. */
export function apelidoPadrao(cliente: string, projetoNome?: string | null): string {
  const c = cliente.trim().replace(/\s+/g, ' ')
  const p = (projetoNome ?? '').trim().replace(/\s+/g, ' ')
  if (!p) return encurtar(c, LIMITE_APELIDO)

  const inteiro = `${c}${SEPARADOR}${p}`
  if (inteiro.length <= LIMITE_APELIDO) return inteiro

  // Reparte o que sobra entre os dois, dando o mínimo a cada um antes de
  // devolver o resto a quem é mais longo.
  const disponivel = LIMITE_APELIDO - SEPARADOR.length
  const metade = Math.floor(disponivel / 2)
  const sobraDoCliente = Math.max(0, metade - c.length)
  const sobraDoProjeto = Math.max(0, disponivel - metade - p.length)
  return `${encurtar(c, metade + sobraDoProjeto)}${SEPARADOR}${encurtar(p, disponivel - metade + sobraDoCliente)}`
}

function encurtar(s: string, max: number): string {
  if (s.length <= max) return s
  return max <= 1 ? s.slice(0, max) : `${s.slice(0, max - 1)}…`
}

/** Junta as duas listas numa só, ordenada por cliente e depois por número.
 *
 *  Os de fora vão para o fim: são os que não temos como agir sobre, e deixá-los
 *  no meio esconderia os nossos. */
export function cruzar(
  noTwilio: NumeroDaConta[],
  naAvexa: DonoDoNumero[],
): NumeroInventariado[] {
  const porE164 = new Map(naAvexa.map((n) => [n.e164, n]))
  const vistos = new Set<string>()
  const saida: NumeroInventariado[] = []

  for (const t of noTwilio) {
    const nosso = porE164.get(t.e164)
    if (nosso) vistos.add(t.e164)
    const sugerido = nosso?.clienteNome
      ? apelidoPadrao(nosso.clienteNome, nosso.projetoNome)
      : null

    saida.push({
      sid: t.sid,
      e164: t.e164,
      apelido: t.apelido,
      capacidades: t.capacidades,
      webhookSms: t.webhookSms,
      origem: nosso ? 'avexa' : 'fora',
      clienteId: nosso?.clienteId ?? null,
      clienteNome: nosso?.clienteNome ?? null,
      projetoId: nosso?.projetoId ?? null,
      projetoNome: nosso?.projetoNome ?? null,
      status: nosso?.status ?? null,
      apelidoSugerido: sugerido,
      foraDoPadrao: sugerido !== null && sugerido !== t.apelido,
    })
  }

  // O que a Avexa tem e o Twilio não: o caso que passa despercebido.
  for (const n of naAvexa) {
    if (vistos.has(n.e164)) continue
    saida.push({
      sid: n.provedorSid,
      e164: n.e164,
      apelido: '',
      capacidades: [],
      webhookSms: null,
      origem: 'sumido',
      clienteId: n.clienteId,
      clienteNome: n.clienteNome,
      projetoId: n.projetoId,
      projetoNome: n.projetoNome,
      status: n.status,
      apelidoSugerido: n.clienteNome ? apelidoPadrao(n.clienteNome, n.projetoNome) : null,
      foraDoPadrao: false,
    })
  }

  const peso: Record<OrigemNumero, number> = { sumido: 0, avexa: 1, fora: 2 }
  return saida.sort(
    (a, b) =>
      peso[a.origem] - peso[b.origem] ||
      (a.clienteNome ?? '').localeCompare(b.clienteNome ?? '') ||
      a.e164.localeCompare(b.e164),
  )
}
