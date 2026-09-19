import { requisitar, type Buscar } from '@avexa/adapters'

/** Camada de modelo de linguagem, plugável como os canais.
 *
 *  Mesma ideia dos adaptadores: o produto fala com esta interface, e trocar de
 *  provedor é configuração, não reescrita. O default é Gemini. */

export interface PedidoIA {
  sistema?: string
  prompt: string
  /** Pede resposta em JSON. O provedor aplica o modo estruturado quando tem um. */
  json?: boolean
  temperatura?: number
  maxTokens?: number
}

export interface ModeloIA {
  readonly provedor: string
  readonly modelo: string
  gerar(pedido: PedidoIA): Promise<{ ok: boolean; texto: string; erro?: string }>
}

export interface ConfigGemini {
  apiKey: string
  modelo?: string
  buscar?: Buscar
}

export function modeloGemini(cfg: ConfigGemini): ModeloIA {
  const modelo = cfg.modelo ?? 'gemini-2.5-flash'

  return {
    provedor: 'google',
    modelo,
    async gerar(p) {
      const r = await requisitar(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          cabecalhos: { 'x-goog-api-key': cfg.apiKey },
          corpo: {
            contents: [{ role: 'user', parts: [{ text: p.prompt }] }],
            ...(p.sistema ? { systemInstruction: { parts: [{ text: p.sistema }] } } : {}),
            generationConfig: {
              temperature: p.temperatura ?? 0.2,
              maxOutputTokens: p.maxTokens ?? 1024,
              ...(p.json ? { responseMimeType: 'application/json' } : {}),
            },
          },
          ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
        },
      )

      if (!r.ok) return { ok: false, texto: '', erro: r.erro ?? '' }

      const c = r.corpo as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      } | null
      const texto = (c?.candidates?.[0]?.content?.parts ?? [])
        .map((x) => x.text ?? '')
        .join('')
        .trim()

      return { ok: true, texto }
    },
  }
}

/** Modelo fixo, para teste e para o modo seco. */
export function modeloFixo(resposta: string): ModeloIA {
  return {
    provedor: 'fixo',
    modelo: 'fixo',
    async gerar() {
      return { ok: true, texto: resposta }
    },
  }
}

export function modeloDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): ModeloIA | null {
  const provedor = (env.IA_PROVEDOR ?? 'gemini').toLowerCase()
  if (provedor === 'gemini' && env.GEMINI_API_KEY) {
    return modeloGemini({
      apiKey: env.GEMINI_API_KEY,
      ...(env.IA_MODELO ? { modelo: env.IA_MODELO } : {}),
    })
  }
  return null
}
