import type { ModeloIA } from './modelo.ts'

/** Nó "Qualificar com IA": lê tudo que aconteceu e devolve um score de 0 a 100
 *  com o motivo.
 *
 *  O ponto delicado não é o prompt, é a falha. Quando o modelo não responde, ou
 *  responde algo que não dá para ler, o lead **não** pode ser descartado: um
 *  score inventado mandaria para o lixo alguém que respondeu de verdade. Nesse
 *  caso a função devolve score nulo e o fluxo segue pelo ramo "não qualificado"
 *  com o motivo registrado, para alguém olhar. */

export interface EntradaQualificacao {
  /** O que o cliente vende, para o modelo saber o que é um bom lead. */
  contexto: string
  /** Critérios escritos pelo operador na etapa. */
  criterios: string
  /** Transcrição da ligação, mensagens trocadas, respostas de formulário. */
  historico: string
  campos?: Record<string, unknown>
}

export interface Qualificacao {
  score: number | null
  motivo: string
  resumo: string
  /** Falso quando o modelo falhou e o resultado é o de segurança. */
  confiavel: boolean
}

const SISTEMA = `Você avalia leads para uma escola, a partir do que aconteceu no contato.
Responda SOMENTE com JSON no formato:
{"score": <inteiro de 0 a 100>, "motivo": "<uma frase>", "resumo": "<duas frases>"}
O score mede quanto este lead se encaixa nos critérios do cliente, não quanto ele foi educado.
Lead que não respondeu nada recebe score baixo. Não invente informação que não está no histórico.`

function lerJson(texto: string): { score?: unknown; motivo?: unknown; resumo?: unknown } | null {
  // O modelo às vezes embrulha o JSON em cerca de código, mesmo pedindo JSON puro.
  const limpo = texto.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const v = JSON.parse(limpo)
    return typeof v === 'object' && v !== null ? v : null
  } catch {
    // Última tentativa: o primeiro objeto que apareça no texto.
    const m = /\{[\s\S]*\}/.exec(limpo)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

export async function qualificar(
  modelo: ModeloIA | null,
  entrada: EntradaQualificacao,
): Promise<Qualificacao> {
  if (!modelo) {
    return {
      score: null,
      motivo: 'nenhum modelo de IA configurado',
      resumo: '',
      confiavel: false,
    }
  }

  const prompt = [
    `Cliente: ${entrada.contexto}`,
    `Critérios de pontuação: ${entrada.criterios || 'não informados'}`,
    entrada.campos && Object.keys(entrada.campos).length
      ? `Dados do lead: ${JSON.stringify(entrada.campos)}`
      : '',
    `Histórico do contato:\n${entrada.historico || '(nenhum contato registrado)'}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const r = await modelo.gerar({ sistema: SISTEMA, prompt, json: true, temperatura: 0.1 })

  if (!r.ok) {
    return { score: null, motivo: `falha ao qualificar: ${r.erro ?? ''}`, resumo: '', confiavel: false }
  }

  const v = lerJson(r.texto)
  const bruto = Number(v?.score)

  if (!v || !Number.isFinite(bruto)) {
    return {
      score: null,
      motivo: 'resposta do modelo não pôde ser lida',
      resumo: '',
      confiavel: false,
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(bruto))),
    motivo: typeof v.motivo === 'string' ? v.motivo : '',
    resumo: typeof v.resumo === 'string' ? v.resumo : '',
    confiavel: true,
  }
}
