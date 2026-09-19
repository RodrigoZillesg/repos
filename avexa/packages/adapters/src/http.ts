/** Cliente HTTP comum aos adaptadores.
 *
 *  O que importa aqui é a classificação do erro, não o transporte: o motor
 *  precisa saber se vale reenfileirar. Timeout, 429 e 5xx são passageiros e a
 *  tentativa volta para a fila; 4xx é definitivo e reenviar só gastaria cota. */

export type Buscar = typeof fetch

export interface RespostaHttp {
  ok: boolean
  status: number
  corpo: unknown
  erro?: string
  reenviavel: boolean
}

export interface OpcoesHttp {
  metodo?: string
  cabecalhos?: Record<string, string>
  corpo?: unknown
  /** Corpo já serializado, enviado byte a byte como está.
   *  Existe para assinatura: quem assina precisa assinar exatamente o que sai,
   *  e reserializar o objeto na hora do envio pode mudar a ordem das chaves. */
  corpoCru?: string
  /** Envia como form-urlencoded em vez de JSON. O Twilio exige. */
  formulario?: boolean
  timeoutMs?: number
  buscar?: Buscar
}

export async function requisitar(url: string, o: OpcoesHttp = {}): Promise<RespostaHttp> {
  const buscar = o.buscar ?? fetch
  const controle = new AbortController()
  const prazo = setTimeout(() => controle.abort(), o.timeoutMs ?? 20_000)

  try {
    const cabecalhos: Record<string, string> = { ...o.cabecalhos }
    let corpo: string | undefined

    if (o.corpoCru !== undefined) {
      cabecalhos['content-type'] ??= 'application/json'
      corpo = o.corpoCru
    } else if (o.corpo !== undefined) {
      if (o.formulario) {
        cabecalhos['content-type'] = 'application/x-www-form-urlencoded'
        corpo = new URLSearchParams(o.corpo as Record<string, string>).toString()
      } else {
        cabecalhos['content-type'] = 'application/json'
        corpo = JSON.stringify(o.corpo)
      }
    }

    const r = await buscar(url, {
      method: o.metodo ?? 'POST',
      headers: cabecalhos,
      ...(corpo !== undefined ? { body: corpo } : {}),
      signal: controle.signal,
    })

    const texto = await r.text()
    let lido: unknown = texto
    try {
      lido = texto ? JSON.parse(texto) : null
    } catch {
      // Resposta não-JSON: o texto cru já serve para o diagnóstico.
    }

    if (r.ok) return { ok: true, status: r.status, corpo: lido, reenviavel: false }

    return {
      ok: false,
      status: r.status,
      corpo: lido,
      erro: `HTTP ${r.status}: ${texto.slice(0, 300)}`,
      // 429 e 5xx passam; 4xx não. Reenviar um 400 só gastaria cota.
      reenviavel: r.status === 429 || r.status >= 500,
    }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    const abortado = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      corpo: null,
      erro: abortado ? `timeout após ${o.timeoutMs ?? 20_000}ms` : erro,
      // Falha de rede e timeout são passageiros por definição.
      reenviavel: true,
    }
  } finally {
    clearTimeout(prazo)
  }
}
