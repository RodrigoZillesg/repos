/** Substituição de variáveis em template.
 *
 *  O texto fixo de um template de WhatsApp é aprovado pela Meta; as variáveis
 *  não. Por isso a substituição nunca pode introduzir texto novo por acidente:
 *  uma variável ausente vira vazio, e o que foi substituído não é substituído de
 *  novo — senão um valor vindo do formulário do lead poderia injetar outro
 *  marcador e mudar a mensagem aprovada. */

export interface ResultadoRender {
  texto: string
  /** Variáveis que o template pedia e que não vieram. */
  faltando: string[]
}

const MARCADOR = /\{\{\s*([\p{L}\p{N}_.]+)\s*\}\}/gu

export function renderizar(
  modelo: string,
  valores: Record<string, unknown>,
  opcoes: { manterAusentes?: boolean } = {},
): ResultadoRender {
  const faltando: string[] = []

  // Uma passada só: o resultado da substituição não é reexaminado, então um
  // valor que contenha {{...}} entra como texto literal.
  const texto = modelo.replace(MARCADOR, (inteiro, chave: string) => {
    const v = buscar(valores, chave)
    if (v === undefined || v === null || v === '') {
      if (!faltando.includes(chave)) faltando.push(chave)
      return opcoes.manterAusentes ? inteiro : ''
    }
    return String(v)
  })

  return { texto, faltando }
}

/** Aceita caminho com ponto: {{lead.nome}} lê `valores.lead.nome`. */
function buscar(valores: Record<string, unknown>, chave: string): unknown {
  if (chave in valores) return valores[chave]
  let atual: unknown = valores
  for (const parte of chave.split('.')) {
    if (typeof atual !== 'object' || atual === null) return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

/** Nomes das variáveis que um template usa, na ordem em que aparecem.
 *
 *  A Cloud API do WhatsApp recebe as variáveis por posição, então a ordem do
 *  corpo aprovado é o que manda. */
export function variaveisDe(modelo: string): string[] {
  const nomes: string[] = []
  for (const m of modelo.matchAll(MARCADOR)) {
    const chave = m[1]!
    if (!nomes.includes(chave)) nomes.push(chave)
  }
  return nomes
}
