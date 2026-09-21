import { ETAPAS } from './etapas.ts'
import type { Canal, Etapa, Grafo } from './tipos.ts'

/** Validação de um fluxo antes de publicar.
 *
 *  Publicar é o momento em que o fluxo passa a receber lead de verdade. Um erro
 *  aqui não aparece como erro: aparece como lead entrando e nada acontecendo.
 *  Por isso a validação separa o que impede de publicar do que é só aviso. */

export type Gravidade = 'erro' | 'aviso'

export interface Achado {
  gravidade: Gravidade
  etapaId?: string
  mensagem: string
}

export interface ContextoValidacao {
  /** Canais que o cliente contratou. */
  canaisAtivos: Record<string, boolean>
  /** Nomes de template aprovados, por canal. */
  templatesAprovados: Partial<Record<Canal, string[]>>
  /** Fluxos que existem neste cliente, por id e nome.
   *
   *  Os dois, e não só o nome, porque `subfluxo.cfg.alvo` guardou nome durante
   *  um tempo: o select do construtor não tinha `value`, então o valor da opção
   *  era o texto. Fluxos publicados com esse formato continuam no banco. */
  fluxosDoCliente: FluxoConhecido[]
}

export interface FluxoConhecido {
  id: string
  nome: string
}

/** Resolve o alvo de um subfluxo aceitando id ou nome.
 *
 *  Nome é o formato antigo e é frágil — renomear o fluxo quebrava a chamada em
 *  silêncio, em execução, sem erro nenhum. Continuamos lendo nome para não
 *  invalidar o que já está publicado, mas o construtor só grava id. */
export function acharFluxoAlvo(
  alvo: string,
  fluxos: readonly FluxoConhecido[],
): FluxoConhecido | null {
  return fluxos.find((f) => f.id === alvo) ?? fluxos.find((f) => f.nome === alvo) ?? null
}

function percorrer(lista: Etapa[], visitar: (e: Etapa) => void): void {
  for (const e of lista) {
    visitar(e)
    for (const ramo of ['sim', 'nao', 'corpo'] as const) {
      if (e[ramo]) percorrer(e[ramo]!, visitar)
    }
  }
}

export function validarGrafo(grafo: Grafo, ctx: ContextoValidacao): Achado[] {
  const achados: Achado[] = []
  const erro = (mensagem: string, etapaId?: string) =>
    achados.push({ gravidade: 'erro', mensagem, ...(etapaId ? { etapaId } : {}) })
  const aviso = (mensagem: string, etapaId?: string) =>
    achados.push({ gravidade: 'aviso', mensagem, ...(etapaId ? { etapaId } : {}) })

  if (grafo.length === 0) {
    erro('O fluxo está vazio.')
    return achados
  }

  if (grafo[0]?.tipo !== 'entrada') {
    erro('O fluxo precisa começar com uma etapa de entrada de lead.', grafo[0]?.id)
  }

  const ids = new Set<string>()
  let entradas = 0
  let contatos = 0

  percorrer(grafo, (e) => {
    if (ids.has(e.id)) erro(`Duas etapas com o mesmo identificador (${e.id}).`, e.id)
    ids.add(e.id)

    const def = ETAPAS[e.tipo]
    if (!def) {
      erro(`Tipo de etapa desconhecido: ${e.tipo}.`, e.id)
      return
    }
    if (e.tipo === 'entrada') entradas++

    if (def.canal) {
      contatos++
      if (!ctx.canaisAtivos[def.canal]) {
        // Aviso, não erro: o motor pula a etapa e o fluxo continua pelos outros
        // canais. Impedir a publicação por causa disso seria rígido demais.
        aviso(`${def.nome}: o cliente não contratou este canal, a etapa será pulada.`, e.id)
      }
    }

    // Template exigido e não aprovado impede o envio — e o motor sabe disso,
    // mas quem está publicando precisa saber antes.
    const campoTemplate = def.campos.find((c) => c.tipo === 'template')
    if (campoTemplate && (!campoTemplate.visivelSe || campoTemplate.visivelSe(e.cfg))) {
      const nome = e.cfg[campoTemplate.k]
      const aprovados = ctx.templatesAprovados[campoTemplate.canalTemplate as Canal] ?? []
      if (!nome) erro(`${def.nome}: nenhum template escolhido.`, e.id)
      else if (!aprovados.includes(nome)) {
        erro(`${def.nome}: o template "${nome}" não está aprovado.`, e.id)
      }
    }

    if (e.tipo === 'subfluxo') {
      const alvo = e.cfg.alvo
      if (!alvo) erro('Executar outro fluxo: nenhum fluxo escolhido.', e.id)
      else {
        const achado = acharFluxoAlvo(alvo, ctx.fluxosDoCliente)
        if (!achado) erro(`Executar outro fluxo: "${alvo}" não existe neste cliente.`, e.id)
        // Referência por nome ainda funciona, mas é uma bomba-relógio: quem
        // renomear o fluxo quebra esta chamada sem receber erro nenhum, porque
        // a validação só roda ao publicar e este fluxo talvez nunca seja
        // publicado de novo.
        else if (achado.id !== alvo) {
          aviso(
            `Executar outro fluxo: "${alvo}" está referenciado pelo nome. Reescolha o fluxo no campo para gravar a referência fixa — renomeá-lo hoje quebraria esta etapa em silêncio.`,
            e.id,
          )
        }
      }
    }

    if (e.tipo === 'webhookout' && !/^https?:\/\//.test(e.cfg.url ?? '')) {
      erro('Webhook de saída: a URL de destino precisa começar com http:// ou https://.', e.id)
    }

    if (e.tipo === 'condicao') {
      if (!e.cfg.valor) aviso('Condição sem valor de comparação: o ramo "não" vai receber tudo.', e.id)
      if ((e.sim?.length ?? 0) === 0 && (e.nao?.length ?? 0) === 0) {
        aviso('Condição com os dois ramos vazios: ela não muda nada.', e.id)
      }
    }

    if (e.tipo === 'loop' && (e.corpo?.length ?? 0) === 0) {
      aviso('Repetição com bloco vazio: ela não faz nada.', e.id)
    }

    if (e.tipo === 'marcar' && !e.cfg.tag) {
      aviso('Marcar lead sem etiqueta definida.', e.id)
    }
  })

  if (entradas > 1) erro('O fluxo tem mais de uma etapa de entrada.')
  if (contatos === 0) {
    aviso('O fluxo não tem nenhuma etapa de canal: nenhum contato vai sair dele.')
  }

  return achados
}

export const temErro = (achados: Achado[]): boolean => achados.some((a) => a.gravidade === 'erro')
