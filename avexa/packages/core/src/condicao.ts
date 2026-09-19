/** Avaliador da etapa de condição.
 *
 *  Enxerga o que o fluxo acumulou até ali: respostas, score, tentativas feitas,
 *  UTMs e qualquer campo personalizado que tenha chegado no webhook — inclusive um
 *  que ninguém previu, porque tudo que vem no corpo da requisição é guardado. */
export interface ContextoFluxo {
  respondeu?: boolean
  score?: number
  canalPreferido?: string
  tentativasFeitas?: number
  atendeuLigacao?: boolean
  utm?: Record<string, string>
  campos?: Record<string, unknown>
  etiquetas?: string[]
  qualificado?: boolean
  /** O contexto acumula o que o fluxo aprendeu, inclusive campo personalizado
   *  que ninguém previu. A assinatura aberta é deliberada: exigir declaração
   *  prévia quebraria a promessa de que tudo que chega no webhook fica
   *  disponível nas condições e nos textos. */
  [chave: string]: unknown
}

export type Operador =
  | 'é igual a'
  | 'é diferente de'
  | 'é maior que'
  | 'é menor que'
  | 'começa com'
  | 'termina com'

function valorDoCampo(campo: string, chave: string, ctx: ContextoFluxo): unknown {
  switch (campo) {
    case 'Lead respondeu':
      return ctx.respondeu ?? false
    case 'Score do lead':
      return ctx.score ?? null
    case 'Canal preferido':
      return ctx.canalPreferido ?? null
    case 'Tentativas feitas':
      return ctx.tentativasFeitas ?? 0
    case 'Atendeu a ligação':
      return ctx.atendeuLigacao ?? false
    case 'utm_source':
    case 'utm_campaign':
      return ctx.utm?.[campo] ?? null
    case 'Campo personalizado':
      return ctx.campos?.[chave] ?? null
    default:
      // Campo desconhecido não derruba o fluxo: vale como ausente.
      return ctx.campos?.[campo] ?? null
  }
}

/** Normaliza para comparação. "Sim"/"true"/"1" são o mesmo sim. */
function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return String(v).trim().toLowerCase()
}

function comoBooleano(v: unknown): boolean | undefined {
  const t = comoTexto(v)
  if (['sim', 'true', '1', 'yes'].includes(t)) return true
  if (['não', 'nao', 'false', '0', 'no'].includes(t)) return false
  return undefined
}

function comoNumero(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Resolve uma condição do construtor. Valor ausente nunca lança: devolve falso,
 *  e o fluxo segue pelo ramo `não`. */
export function avaliarCondicao(
  cfg: { campo?: string; chave?: string; op?: string; valor?: string },
  ctx: ContextoFluxo,
): boolean {
  const esquerda = valorDoCampo(cfg.campo ?? '', cfg.chave ?? '', ctx)
  const direita = cfg.valor ?? ''
  const op = (cfg.op ?? 'é igual a') as Operador

  if (op === 'é maior que' || op === 'é menor que') {
    const a = comoNumero(esquerda)
    const b = comoNumero(direita)
    if (a === undefined || b === undefined) return false
    return op === 'é maior que' ? a > b : a < b
  }

  // Comparação de sim/não aceita as duas grafias dos dois lados.
  const boolEsq = comoBooleano(esquerda)
  const boolDir = comoBooleano(direita)
  if (boolEsq !== undefined && boolDir !== undefined) {
    return op === 'é diferente de' ? boolEsq !== boolDir : boolEsq === boolDir
  }

  const a = comoTexto(esquerda)
  const b = comoTexto(direita)
  switch (op) {
    case 'é igual a':
      return a === b
    case 'é diferente de':
      return a !== b
    case 'começa com':
      return b !== '' && a.startsWith(b)
    case 'termina com':
      return b !== '' && a.endsWith(b)
    default:
      return false
  }
}
