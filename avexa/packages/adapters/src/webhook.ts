import { createHmac, timingSafeEqual } from 'node:crypto'
import { requisitar, type Buscar } from './http.ts'

/** Webhook de saída para o sistema do cliente.
 *
 *  Do outro lado tem gente que vai criar negócio, disparar e-mail e cobrar
 *  cartão com o que chega aqui. Por isso três coisas que um `fetch` solto não
 *  dá:
 *
 *  - **Assinatura.** Sem ela, qualquer um que descubra a URL do cliente inventa
 *    lead no CRM dele. A assinatura é sobre o corpo cru, no mesmo formato que a
 *    Avexa exige de quem manda webhook para cá — um formato só, para o cliente
 *    aprender uma vez.
 *  - **Identificador de entrega.** O reenvio é a regra, não a exceção: sem um
 *    id estável, um 500 do lado do cliente vira lead duplicado na base dele.
 *  - **Reenvio com recuo.** Só para o que é passageiro. Reenviar um 400 é
 *    insistir no erro.
 */

export interface PedidoWebhook {
  url: string
  metodo?: string
  corpo: unknown
  cabecalhos?: Record<string, string>
  /** Segredo compartilhado com o cliente. Sem ele, sai sem assinatura. */
  segredo?: string | undefined
  /** Id estável desta entrega, para o cliente descartar repetição. */
  entregaId: string
  tentativas?: number
  timeoutMs?: number
  buscar?: Buscar
  /** Espera entre tentativas. Injetável para o teste não dormir de verdade. */
  esperar?: (ms: number) => Promise<void>
}

export interface ResultadoWebhook {
  ok: boolean
  status: number
  tentativas: number
  erro?: string
}

/** `t=<epoch>,v1=<hmac hex>` sobre `<t>.<corpo cru>`. */
export function assinarSaida(segredo: string, corpoCru: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', segredo).update(`${t}.${corpoCru}`).digest('hex')
  return `t=${t},v1=${v1}`
}

/** A mesma conferência que o cliente vai fazer do lado dele. Existe aqui para
 *  o painel poder mostrar um exemplo verificável, e para o teste provar que o
 *  que assinamos confere. */
export function conferirAssinaturaSaida(
  cabecalho: string | null | undefined,
  corpoCru: string,
  segredo: string,
  toleranciaSeg = 300,
): boolean {
  if (!cabecalho || !segredo) return false
  const partes = Object.fromEntries(
    cabecalho.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  ) as { t?: string; v1?: string }

  if (!partes.t || !partes.v1) return false
  const idade = Math.abs(Date.now() / 1000 - Number(partes.t))
  if (!Number.isFinite(idade) || idade > toleranciaSeg) return false

  const esperado = createHmac('sha256', segredo).update(`${partes.t}.${corpoCru}`).digest('hex')
  const a = Buffer.from(partes.v1)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

export async function entregarWebhook(p: PedidoWebhook): Promise<ResultadoWebhook> {
  // Serializado uma vez só: é este texto que é assinado e é este que sai.
  const corpoCru = JSON.stringify(p.corpo)
  const vezes = Math.max(1, p.tentativas ?? 3)
  const esperar = p.esperar ?? dormir

  let ultimo: ResultadoWebhook = { ok: false, status: 0, tentativas: 0, erro: 'não tentou' }

  for (let n = 0; n < vezes; n++) {
    const cabecalhos: Record<string, string> = {
      ...p.cabecalhos,
      'user-agent': 'Avexa/1',
      'x-avexa-entrega': p.entregaId,
      'x-avexa-tentativa': String(n + 1),
      ...(p.segredo ? { 'x-avexa-assinatura': assinarSaida(p.segredo, corpoCru) } : {}),
    }

    const r = await requisitar(p.url, {
      metodo: p.metodo ?? 'POST',
      cabecalhos,
      corpoCru,
      timeoutMs: p.timeoutMs ?? 15_000,
      ...(p.buscar ? { buscar: p.buscar } : {}),
    })

    ultimo = {
      ok: r.ok,
      status: r.status,
      tentativas: n + 1,
      ...(r.erro ? { erro: r.erro } : {}),
    }
    if (r.ok || !r.reenviavel) return ultimo

    // Recuo exponencial, e nada de dormir depois da última tentativa.
    if (n < vezes - 1) await esperar(2 ** n * 1000)
  }

  return ultimo
}

/** Cabeçalhos por linha, como o operador digita no nó do fluxo. */
export function lerCabecalhos(texto: string | undefined): Record<string, string> {
  const r: Record<string, string> = {}
  for (const linha of (texto ?? '').split('\n')) {
    const i = linha.indexOf(':')
    if (i > 0) {
      const chave = linha.slice(0, i).trim()
      // Nada de deixar o operador sobrescrever a assinatura por engano.
      if (chave && !chave.toLowerCase().startsWith('x-avexa-')) r[chave] = linha.slice(i + 1).trim()
    }
  }
  return r
}
