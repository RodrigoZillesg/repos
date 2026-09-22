/** Qual número fica escolhido na ativação.
 *
 *  Vive aqui, fora do componente, por dois motivos. O primeiro é poder ser
 *  testado: os testes do painel rodam sobre `src/lib`, porque o Node não
 *  remove tipos de `.tsx`. O segundo é o defeito que esta função existe para
 *  não deixar voltar.
 *
 *  A regra é trivial — se o número escolhido ainda serve, mantém; senão, cai no
 *  primeiro que serve — mas ela é lida dentro de um `useEffect`, e lá a
 *  IDENTIDADE do resultado importa tanto quanto o valor. O React só interrompe
 *  o ciclo de render quando o estado volta igual por `Object.is`. Uma versão
 *  que devolvesse um valor novo a cada chamada, mesmo com o mesmo conteúdo,
 *  faria o efeito disparar outro render, que dispara o efeito — e a página
 *  trava. Foi o que aconteceu na tela de ativação: com a lista de números
 *  vazia e o campo já vazio, o componente entrava em laço e o menu inteiro
 *  parava de responder.
 *
 *  Por isso `escolher` devolve o `atual` quando nada muda, e o teste prende
 *  essa igualdade. */

export interface CanaisContratados {
  ligacao?: boolean | undefined
  sms?: boolean | undefined
}

/** O que o número precisa fazer para servir aos canais contratados.
 *
 *  WhatsApp e e-mail não entram: eles saem do remetente único da Avexa, não do
 *  telefone do projeto. */
export function capacidadesExigidas(canais: CanaisContratados): string[] {
  return [...(canais.ligacao ? ['voz'] : []), ...(canais.sms ? ['sms'] : [])]
}

export function servem<T extends { capacidades: string[] }>(livres: T[], precisa: string[]): T[] {
  return livres.filter((n) => precisa.every((c) => n.capacidades.includes(c)))
}

/** O número que deve ficar selecionado.
 *
 *  Devolve o próprio `atual` sempre que ele continua valendo — inclusive
 *  quando é vazio e não há nada para escolher. Quem chama depende disso para
 *  não mexer no estado à toa. */
export function escolher(atual: string, uteis: Array<{ e164: string }>): string {
  if (uteis.some((n) => n.e164 === atual)) return atual
  return uteis[0]?.e164 ?? ''
}
