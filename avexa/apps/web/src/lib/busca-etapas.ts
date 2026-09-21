import { ETAPAS, type TipoEtapa } from '@avexa/core'

/** A busca da paleta de etapas.
 *
 *  Em `.ts` e não junto do componente porque o Node não faz type stripping em
 *  `.tsx`: lógica pura dentro de um arquivo com JSX não pode ser testada. E é
 *  aqui que mora o que decide se a paleta é rápida — a ordenação e o
 *  dobramento de acento.
 *
 *  Sem biblioteca: são dezesseis tipos, e o que se precisa é filtrar e ordenar.
 */

/** Tira acento e caixa: quem procura "ligacao" tem que achar "Ligação". */
const dobrar = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface EtapaEncontrada {
  tipo: TipoEtapa
  nome: string
  grupo: string
  /** Canal não contratado: aparece, mas não dá para escolher. Esconder faria o
   *  operador procurar uma etapa que ele sabe que existe. */
  bloqueada: boolean
}

export function buscarEtapas(
  termo: string,
  canais: Record<string, boolean>,
): EtapaEncontrada[] {
  const t = dobrar(termo.trim())
  const todas = (Object.entries(ETAPAS) as Array<[TipoEtapa, (typeof ETAPAS)[TipoEtapa]]>)
    .filter(([, d]) => !d.fixa)
    .map(([tipo, d]) => ({
      tipo,
      nome: d.nome,
      grupo: d.grupo,
      bloqueada: Boolean(d.canal && !canais[d.canal]),
    }))

  if (!t) return todas

  // Quem começa com o termo vem antes de quem só o contém: digitar "e" tem que
  // oferecer "E-mail" antes de "Esperar"... e de "Executar outro fluxo".
  const pontua = (e: EtapaEncontrada) => {
    const nome = dobrar(e.nome)
    if (nome.startsWith(t)) return 0
    if (nome.includes(t)) return 1
    if (dobrar(e.grupo).includes(t)) return 2
    return -1
  }

  return todas
    .map((e) => ({ e, p: pontua(e) }))
    .filter((x) => x.p >= 0)
    .sort((a, b) => a.p - b.p || a.e.nome.localeCompare(b.e.nome))
    .map((x) => x.e)
}
