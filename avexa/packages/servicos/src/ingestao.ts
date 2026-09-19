import { and, desc, eq } from 'drizzle-orm'
import { cliente, execucao, fluxo, fluxoVersao, lead, type Db } from '@avexa/db'
import {
  chaveDedupe,
  duracaoEmMinutos,
  etapaEm,
  normalizarEmail,
  normalizarTelefone,
  type Etapa,
  type Grafo,
  type Pais,
} from '@avexa/core'
import { agendarAvanco } from './fila.ts'

/** Entrada de lead pelo webhook do fluxo.
 *
 *  O contrato é deliberadamente frouxo: o cliente cola a URL na saída do
 *  formulário dele e manda o que quiser. Nós procuramos telefone e e-mail entre
 *  os nomes de campo mais comuns, guardamos o corpo cru inteiro, e qualquer
 *  campo extra continua disponível nas condições e nos textos. Exigir um formato
 *  quebraria a promessa de "cola e pronto". */

const NOMES_TELEFONE = ['telefone', 'phone', 'celular', 'mobile', 'whatsapp', 'tel', 'phone_number']
const NOMES_EMAIL = ['email', 'e-mail', 'mail', 'email_address']
const NOMES_NOME = ['nome', 'name', 'full_name', 'first_name', 'nome_completo']

function acharCampo(dados: Record<string, unknown>, nomes: string[]): string | null {
  for (const [chave, valor] of Object.entries(dados)) {
    const k = chave.toLowerCase().replace(/[\s_-]/g, '')
    if (nomes.some((n) => k === n.replace(/[\s_-]/g, ''))) {
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        return String(valor)
      }
    }
  }
  return null
}

function extrairUtm(dados: Record<string, unknown>): Record<string, string> {
  const utm: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(dados)) {
    if (chave.toLowerCase().startsWith('utm_') && valor != null) {
      utm[chave.toLowerCase()] = String(valor)
    }
  }
  return utm
}

export type ResultadoIngestao =
  | { aceito: true; leadId: string; execucaoId: string }
  | { aceito: false; motivo: 'fluxo_nao_publicado' | 'lead_velho' | 'duplicado' | 'sem_identificador' | 'cliente_inativo' }

export interface EntradaWebhook {
  clienteSlug: string
  fluxoSlug: string
  dados: Record<string, unknown>
  /** Quando o formulário informa o instante do envio, respeitamos a idade máxima. */
  enviadoEm?: Date
}

export async function ingerirLead(
  db: Db,
  entrada: EntradaWebhook,
  agora = new Date(),
): Promise<ResultadoIngestao> {
  const [cli] = await db
    .select()
    .from(cliente)
    .where(eq(cliente.slug, entrada.clienteSlug))
    .limit(1)
  if (!cli || cli.status === 'encerrado') return { aceito: false, motivo: 'cliente_inativo' }

  const [flu] = await db
    .select()
    .from(fluxo)
    .where(and(eq(fluxo.clienteId, cli.id), eq(fluxo.slug, entrada.fluxoSlug)))
    .limit(1)
  if (!flu || flu.status !== 'publicado' || !flu.versaoPublicadaId) {
    return { aceito: false, motivo: 'fluxo_nao_publicado' }
  }

  const [versao] = await db
    .select()
    .from(fluxoVersao)
    .where(eq(fluxoVersao.id, flu.versaoPublicadaId))
    .limit(1)
  if (!versao) return { aceito: false, motivo: 'fluxo_nao_publicado' }

  const grafo = versao.grafo as Grafo
  const entradaEtapa = etapaEm(grafo, [{ indice: 0 }])
  const cfgEntrada = entradaEtapa?.tipo === 'entrada' ? entradaEtapa.cfg : {}

  const pais = (cli.fusoHorario.startsWith('America/Sao') ? 'BR' : 'AU') as Pais
  const telefone = normalizarTelefone(acharCampo(entrada.dados, NOMES_TELEFONE), pais)
  const email = normalizarEmail(acharCampo(entrada.dados, NOMES_EMAIL))
  if (!telefone && !email) return { aceito: false, motivo: 'sem_identificador' }

  // Idade máxima: lead velho demais não vale a pena contatar, e contatar alguém
  // que preencheu um formulário há três dias soa mal.
  if (entrada.enviadoEm && cfgEntrada.idade) {
    const limiteMin = duracaoEmMinutos(cfgEntrada.idade)
    const idadeMin = (agora.getTime() - entrada.enviadoEm.getTime()) / 60_000
    if (idadeMin > limiteMin) return { aceito: false, motivo: 'lead_velho' }
  }

  const { acharOuCriarPessoa } = await import('./supressao.ts')
  const pes = await acharOuCriarPessoa(db, { telefone, email }, pais)

  const dedupe = chaveDedupe(cli.id, flu.id, telefone, email)
  const politica = cfgEntrada.dedupe ?? 'Atualizar e não recontatar'

  const [anterior] = await db
    .select({ id: lead.id, criadoEm: lead.criadoEm })
    .from(lead)
    .where(eq(lead.dedupeKey, dedupe))
    .orderBy(desc(lead.criadoEm))
    .limit(1)

  if (anterior) {
    if (politica === 'Ignorar o novo envio') return { aceito: false, motivo: 'duplicado' }
    if (politica === 'Atualizar e não recontatar') {
      await db
        .update(lead)
        .set({ dados: entrada.dados, campos: entrada.dados, utm: extrairUtm(entrada.dados) })
        .where(eq(lead.id, anterior.id))
      return { aceito: false, motivo: 'duplicado' }
    }
    // 'Recontatar após 30 dias'
    const dias = (agora.getTime() - anterior.criadoEm.getTime()) / 86_400_000
    if (dias < 30) return { aceito: false, motivo: 'duplicado' }
  }

  const [novo] = await db
    .insert(lead)
    .values({
      clienteId: cli.id,
      fluxoId: flu.id,
      pessoaId: pes.id,
      nome: acharCampo(entrada.dados, NOMES_NOME),
      telefone,
      email,
      fusoHorario: cli.fusoHorario,
      idioma: cli.idiomaPadrao,
      dados: entrada.dados,
      campos: entrada.dados,
      utm: extrairUtm(entrada.dados),
      dedupeKey: dedupe,
    })
    .returning({ id: lead.id })

  const [exec] = await db
    .insert(execucao)
    .values({
      leadId: novo!.id,
      clienteId: cli.id,
      fluxoId: flu.id,
      fluxoVersaoId: versao.id,
      posicao: [{ indice: 0 }],
      contexto: {},
      // Herdado do cliente no nascimento: mudar o cliente depois não muda o que
      // já está em curso.
      dryRun: cli.dryRun,
      cadeia: [flu.id],
    })
    .returning({ id: execucao.id })

  await agendarAvanco(exec!.id)
  return { aceito: true, leadId: novo!.id, execucaoId: exec!.id }
}

/** Só para diagnóstico no painel: o que a ingestão enxergaria neste corpo. */
export function inspecionarPayload(dados: Record<string, unknown>, pais: Pais = 'AU') {
  return {
    nome: acharCampo(dados, NOMES_NOME),
    telefone: normalizarTelefone(acharCampo(dados, NOMES_TELEFONE), pais),
    email: normalizarEmail(acharCampo(dados, NOMES_EMAIL)),
    utm: extrairUtm(dados),
    camposExtras: Object.keys(dados).filter(
      (k) => !k.toLowerCase().startsWith('utm_'),
    ),
  }
}

export type { Etapa }
