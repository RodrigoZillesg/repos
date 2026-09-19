/** Normalização de identificadores de contato.
 *
 *  A supressão é global por pessoa, e uma lista global só funciona se o mesmo
 *  telefone escrito de cinco formas diferentes virar a mesma chave. Um erro aqui
 *  não aparece como erro: aparece como um contato indo para alguém que pediu para
 *  parar. Por isso a normalização é pura, testada e única — banco, adaptador e
 *  motor usam esta, e nenhuma outra. */

/** DDI dos países onde a Avexa opera. */
const DDI: Record<string, { codigo: string; tamanhoNacional: number[] }> = {
  AU: { codigo: '61', tamanhoNacional: [9] },
  US: { codigo: '1', tamanhoNacional: [10] },
  CA: { codigo: '1', tamanhoNacional: [10] },
  BR: { codigo: '55', tamanhoNacional: [10, 11] },
  GB: { codigo: '44', tamanhoNacional: [10] },
}

export type Pais = keyof typeof DDI

/** Converte um telefone para E.164, ou devolve `null` se não der para confiar.
 *
 *  Devolver `null` é deliberado: número que não dá para normalizar com segurança
 *  não vira chave de supressão nem destinatário. Melhor não contatar do que
 *  contatar a pessoa errada. */
export function normalizarTelefone(bruto: string | null | undefined, paisPadrao: Pais = 'AU'): string | null {
  if (!bruto) return null

  const texto = String(bruto).trim()
  // Extensão ramal e qualquer coisa depois dela não fazem parte do número.
  const semRamal = texto.split(/(?:ext|ramal|x)\.?\s*\d+$/i)[0] ?? texto

  const temMais = semRamal.trimStart().startsWith('+')
  let digitos = semRamal.replace(/\D/g, '')
  if (!digitos) return null

  // Prefixo internacional discado. O `011` americano colide com o DDD 11
  // brasileiro precedido de tronco 0, então só vale onde ele é o prefixo de fato.
  let internacional = temMais
  if (!internacional) {
    if (digitos.startsWith('00') && digitos.length > 10) {
      digitos = digitos.slice(2)
      internacional = true
    } else if ((paisPadrao === 'US' || paisPadrao === 'CA') && digitos.startsWith('011')) {
      digitos = digitos.slice(3)
      internacional = true
    }
  }

  if (internacional) {
    if (digitos.length < 8 || digitos.length > 15) return null
    return `+${digitos}`
  }

  const pais = DDI[paisPadrao]
  if (!pais) return null

  // Tronco nacional: 0 na Austrália, no Reino Unido e antes do DDD no Brasil.
  const nacional = digitos.startsWith('0') ? digitos.slice(1) : digitos
  if (pais.tamanhoNacional.includes(nacional.length)) {
    return `+${pais.codigo}${nacional}`
  }

  // Número com DDI mas sem o `+`, que é como muito formulário entrega.
  if (digitos.startsWith(pais.codigo)) {
    const resto = digitos.slice(pais.codigo.length)
    if (pais.tamanhoNacional.includes(resto.length)) return `+${digitos}`
  }

  return null
}

/** Normaliza um e-mail para comparação.
 *
 *  Só minúsculas e aparo de espaço. De propósito não removemos pontos do Gmail
 *  nem sufixo +tag: a pessoa que pediu opt-out escreveu um endereço, e inventar
 *  equivalências suprimiria endereços que ela não pediu para suprimir. */
export function normalizarEmail(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const texto = String(bruto).trim().toLowerCase()
  // Validação mínima: um arroba, algo dos dois lados, um ponto no domínio.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(texto)) return null
  return texto
}

/** Chave de deduplicação de lead: cliente, fluxo e o identificador mais forte
 *  disponível. Telefone ganha do e-mail porque é o que os canais de voz e SMS usam. */
export function chaveDedupe(
  clienteId: string,
  fluxoId: string,
  telefone: string | null,
  email: string | null,
): string {
  return `${clienteId}:${fluxoId}:${telefone ?? email ?? 'sem-identificador'}`
}
