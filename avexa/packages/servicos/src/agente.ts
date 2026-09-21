import { timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { agenteVoz, cliente, configGlobal, numero, projeto, projetoCanal, type Db } from '@avexa/db'
import {
  atualizarAssistente,
  criarAssistente,
  importarNumeroNaVapi,
  segredoDoWebhookVapi,
  vincularAssistenteAoNumero,
  type AssistenteVapi,
  type CredenciaisTwilio,
  type CredenciaisVapi,
} from '@avexa/adapters'

/** O agente de voz de cada cliente.
 *
 *  O esqueleto abaixo veio da estrutura de um agente real em produção, não de
 *  documentação: abertura de compliance, detecção de caixa postal antes de
 *  falar, explicação em duas batidas com check-in, um único pedido, sequência
 *  de encerramento, regras de opt-out e DNC. O que é do cliente virou lacuna.
 *
 *  Deliberadamente SEM ferramentas herdadas. O agente que serviu de base tinha
 *  uma que postava para um sistema de terceiros e outras duas que chamavam
 *  webhooks de n8n — inclusive uma apontando para uma URL de teste, que em
 *  produção responde 404 e travaria a ligação. Aqui o desligamento e a
 *  detecção de caixa postal são nativos da Vapi, e agendar reunião é o
 *  agendamento do próprio Avexa. */

export function credenciaisVapiDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): CredenciaisVapi | null {
  return env.VAPI_API_KEY ? { apiKey: env.VAPI_API_KEY } : null
}

/** Para onde a Vapi manda fim de chamada, transcrição e desfecho. */
export function webhookDeLigacao(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const dominio = env.DOMINIO?.trim().replace(/\/+$/, '')
  return dominio ? `https://${dominio}/api/webhooks/ligacao` : null
}

/** Segredo compartilhado com a Vapi, para provar que um POST veio dela.
 *
 *  Sem isto, `/api/webhooks/ligacao` aceita qualquer requisição de qualquer
 *  um — e um relatório forjado com `desfecho: optout` põe o número de um lead
 *  real na supressão GLOBAL, calando todos os canais com ele. É a mesma
 *  brecha que o webhook de SMS tinha.
 *
 *  Derivado do APP_SECRET em vez de ser um segredo novo: um a menos para
 *  cadastrar, girar e esquecer. Muda junto com o APP_SECRET, e nesse caso os
 *  agentes precisam ser publicados de novo — o que já é verdade para tudo
 *  mais que depende dele. */
export const segredoDoWebhookDeVoz = segredoDoWebhookVapi

/** Comparação em tempo constante: comparar com === vaza, pelo tempo, quantos
 *  bytes iniciais o atacante acertou. */
export function conferirSegredoDeVoz(
  recebido: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const esperado = segredoDoWebhookDeVoz(env)
  if (!esperado || !recebido) return false
  const a = Buffer.from(esperado)
  const b = Buffer.from(recebido)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface DadosDoCliente {
  nome: string
  produto: string
  setor?: string | null
  idioma: string
  emailDoTime?: string | null
}

/** O prompt de sistema do agente.
 *
 *  As regras de compliance vêm primeiro e são as mesmas para todo cliente:
 *  divulgação de IA, gravação, opt-out e DNC não são customizáveis porque não
 *  são preferência, são obrigação. O que muda por cliente é quem liga, o que
 *  vende e o que pede. */
export function promptDoAgente(c: DadosDoCliente): string {
  const oQueVende = c.produto.trim()
  const deQuem = c.nome.trim()

  return `# Agente de voz — ${deQuem}

## CRÍTICO — CAIXA POSTAL, ANTES DE QUALQUER COISA

Antes de cumprimentar, escute por 2 segundos após a conexão. Se ouvir
qualquer destes sinais, você chegou numa caixa postal: encerre sem
cumprimentar e deixe a mensagem gravada.

- silêncio completo por mais de 2 segundos após conectar
- gravação com "deixe sua mensagem", "you've reached the voicemail of",
  "não posso atender agora"
- um bipe sem ninguém falar antes
- menu automático com opções numéricas

Se estiver em dúvida após 3 segundos, diga "Alô?" e espere 2 segundos. Se
o silêncio continuar, é caixa postal. NUNCA diga a apresentação inteira
para o que pode ser uma secretária eletrônica.

Se um sistema antisspam pedir para digitar um número, use o teclado
imediatamente, sem falar antes.

## Identidade

Você trabalha diretamente para ${deQuem}. Você é direto, informado e fácil
de conversar — alguém que quer ajudar de verdade, não alguém lendo roteiro
ou batendo meta.

NUNCA mencione agência, fornecedor ou terceiro. Você é de ${deQuem}.

${deQuem} ${c.setor ? `atua em ${c.setor} e ` : ''}vende ${oQueVende}.

## Entrega de voz

- Não produza respiração audível, suspiro ou som de fôlego entre frases.
- Pausa é silêncio, não é "uhh" nem hum.
- Pergunta sobe no final. Afirmação desce e se fecha. Nunca deixe uma
  afirmação subir como se pedisse aprovação.
- Frases curtas, para nunca precisar respirar no meio de uma ideia.

## Abertura obrigatória

Diga exatamente isto, em toda ligação, sem exceção. Está no campo de
primeira mensagem e não pode divergir dele:

Esta abertura divulga que você é um assistente de IA, que a ligação pode
ser gravada, e por que ${deQuem} está ligando. Não pule, não encurte, não
improvise.

## Conversa

1. **Confirme o contexto** com uma pergunta leve. Não é qualificação — é
   para os próximos 30 segundos soarem como conversa, não como discurso.

2. **Explique em DUAS BATIDAS, nunca num monólogo.** Primeira batida: o que
   é, em 10 a 15 segundos. Então pergunte "isso faz sentido para você?" e
   ESPERE a resposta. Segunda batida: por que serve para ele, ancorada no
   que ele acabou de dizer.

3. **Faça UM pedido, UMA vez.** Se hesitar, esclareça uma vez. Se recusar,
   agradeça de verdade e encerre. Nunca peça uma terceira vez.

4. **Encerre você mesmo.** Depois da despedida, desligue imediatamente. Não
   espere o lead desligar. Não acrescente nada depois da despedida.

## Regras que valem mais que tudo acima

**Opt-out.** Se a pessoa disser qualquer coisa que signifique que não quer
mais contato — "pare de ligar", "me tire da lista", "não me procure mais" —
pare na hora, confirme em voz alta que ela será removida, e desligue.
Interprete a intenção, não só a palavra exata. Isso bloqueia também e-mail
e mensagem, em todos os canais.

**Não me ligue.** Se disser que está em lista de não perturbe ou pedir
remoção permanente, reconheça, desligue, e registre. Não argumente, não
esclareça, não tente continuar.

**Nunca insista para agendar.** Se a pessoa não quiser marcar, encerre. Um
agente que se recusa a desligar até conseguir agendar é assédio, e não é
assim que ${deQuem} trabalha.

**Nunca invente** oferta, desconto, preço, nome de cliente ou resultado. Se
perguntarem um número que você não tem, diga que vai mandar por escrito.

## Desfecho

Toda ligação termina com exatamente um desfecho registrado: aceitou,
recusou, sem resposta, caixa postal, segmento errado, opt-out, ou reunião
marcada.
`
}

/** A primeira fala. Sai da mesma função que o prompt de propósito: no agente
 *  que serviu de base as duas divergiam, e uma delas se declarava obrigatória
 *  e imutável. */
export function primeiraMensagemDoAgente(c: DadosDoCliente): string {
  const deQuem = c.nome.trim()
  return c.idioma.startsWith('pt')
    ? `Oi, tudo bem? Aqui é da ${deQuem}. Você deixou seus dados com a gente há pouco. ` +
        `Só para você saber, eu sou um assistente de inteligência artificial e esta ligação ` +
        `pode ser gravada. Vou ser breve — você tem um minuto?`
    : `Hi, is this {{leadName}}? This is ${deQuem} calling. You recently left your details ` +
        `with us. Just so you know, I'm an AI assistant, and this call may be recorded. ` +
        `I'll keep this brief — do you have a minute?`
}

export function mensagemDeCaixaPostal(c: DadosDoCliente): string {
  const deQuem = c.nome.trim()
  return c.idioma.startsWith('pt')
    ? `Oi, aqui é da ${deQuem}. Ligamos sobre o seu contato com a gente. Retorne quando puder.`
    : `Hi, this is ${deQuem} following up on your enquiry. Please call back when you can.`
}

export type ResultadoAgente =
  | { ok: true; agenteId: string; vapiAssistantId: string | null }
  | { ok: false; erro: string }

/** Cria o agente de voz de um PROJETO no Avexa, a partir do padrão global.
 *
 *  Por projeto porque é ele que tem número: duas frentes do mesmo cliente
 *  atendem por telefones diferentes, e cada telefone precisa do seu roteiro.
 *  Um agente por cliente faria a segunda escola se apresentar como a primeira.
 *
 *  Não fala com a Vapi: guarda a configuração do nosso lado primeiro, para
 *  que uma falha da Vapi não deixe o projeto sem agente nenhum no banco. */
export async function criarAgenteDoProjeto(
  db: Db,
  projetoId: string,
  dados: DadosDoCliente,
): Promise<ResultadoAgente> {
  const [padrao] = await db.select().from(configGlobal).where(eq(configGlobal.id, 1)).limit(1)
  if (!padrao) return { ok: false, erro: 'config_global não existe: rode o seed' }

  const [existente] = await db
    .select()
    .from(agenteVoz)
    .where(eq(agenteVoz.projetoId, projetoId))
    .limit(1)
  if (existente) return { ok: true, agenteId: existente.id, vapiAssistantId: existente.vapiAssistantId }

  const [novo] = await db
    .insert(agenteVoz)
    .values({
      projetoId,
      nome: `Avexa · ${dados.nome}`,
      idioma: dados.idioma,
      modeloProvedor: padrao.vozModeloProvedor,
      modelo: padrao.vozModelo,
      prompt: promptDoAgente(dados),
      primeiraMensagem: primeiraMensagemDoAgente(dados),
      mensagemCaixaPostal: mensagemDeCaixaPostal(dados),
      provedorVoz: padrao.vozProvedorVoz,
      vozId: padrao.vozVozId,
      modeloVoz: padrao.vozModeloVoz,
      transcritor: padrao.vozTranscritor,
      modeloTranscritor: padrao.vozModeloTranscritor,
    })
    .returning({ id: agenteVoz.id })

  return { ok: true, agenteId: novo!.id, vapiAssistantId: null }
}

/** Espelha na Vapi o que está no banco. Cria na primeira vez, atualiza depois. */
export async function publicarAgente(
  db: Db,
  agenteId: string,
  cred: CredenciaisVapi,
  webhook?: string | null,
  segredo?: string | null,
): Promise<ResultadoAgente> {
  const [a] = await db.select().from(agenteVoz).where(eq(agenteVoz.id, agenteId)).limit(1)
  if (!a) return { ok: false, erro: 'agente não encontrado' }

  const corpo: AssistenteVapi = {
    nome: a.nome,
    modeloProvedor: a.modeloProvedor,
    modelo: a.modelo,
    prompt: a.prompt,
    primeiraMensagem: a.primeiraMensagem,
    mensagemEncerramento: a.mensagemEncerramento,
    mensagemCaixaPostal: a.mensagemCaixaPostal,
    provedorVoz: a.provedorVoz,
    vozId: a.vozId,
    modeloVoz: a.modeloVoz,
    transcritor: a.transcritor,
    modeloTranscritor: a.modeloTranscritor,
    idioma: a.idioma,
    webhook: webhook ?? null,
    segredoWebhook: segredo ?? segredoDoWebhookDeVoz(),
    ajustes: a.ajustes,
  }

  const r = a.vapiAssistantId
    ? await atualizarAssistente(cred, a.vapiAssistantId, corpo)
    : await criarAssistente(cred, corpo)

  if (!r.ok) return { ok: false, erro: r.erro }

  await db
    .update(agenteVoz)
    .set({ vapiAssistantId: r.id, publicadoEm: new Date() })
    .where(eq(agenteVoz.id, a.id))

  return { ok: true, agenteId: a.id, vapiAssistantId: r.id }
}

/** Leva o número do projeto para a Vapi e o liga ao agente dele.
 *
 *  Comprar no Twilio não basta para voz: a Vapi identifica número por id
 *  próprio. O id volta para `projeto_canal.config.vozId`, que é de onde o
 *  motor lê na hora de ligar. */
export async function importarNumeroDoProjeto(
  db: Db,
  projetoId: string,
  vapi: CredenciaisVapi,
  twilio: CredenciaisTwilio,
): Promise<{ ok: true; vozId: string } | { ok: false; erro: string }> {
  const [linha] = await db
    .select({ e164: numero.e164 })
    .from(numero)
    .where(and(eq(numero.projetoId, projetoId), eq(numero.provedor, 'twilio')))
    .limit(1)
  if (!linha) return { ok: false, erro: 'este projeto não tem número atribuído' }

  const [agente] = await db
    .select()
    .from(agenteVoz)
    .where(eq(agenteVoz.projetoId, projetoId))
    .limit(1)

  // O apelido na Vapi leva cliente e projeto pelo mesmo motivo do Twilio: a
  // lista de números lá também vira uma coluna de dígitos sem isso.
  const [c] = await db
    .select({ nome: cliente.nome, projeto: projeto.nome })
    .from(projeto)
    .innerJoin(cliente, eq(projeto.clienteId, cliente.id))
    .where(eq(projeto.id, projetoId))
    .limit(1)

  const r = await importarNumeroNaVapi(vapi, {
    e164: linha.e164,
    twilioAccountSid: twilio.accountSid,
    twilioAuthToken: twilio.authToken,
    ...(agente?.vapiAssistantId ? { assistantId: agente.vapiAssistantId } : {}),
    ...(c ? { apelido: `${c.nome} · ${c.projeto}` } : {}),
  })
  if (!r.ok) return { ok: false, erro: r.erro }

  // Se o agente foi publicado depois da importação, o vínculo ainda não
  // existe — um número sem assistente não atende ninguém.
  if (agente?.vapiAssistantId) {
    await vincularAssistenteAoNumero(vapi, r.id, agente.vapiAssistantId)
  }

  await db
    .update(numero)
    .set({ assistenteId: agente?.vapiAssistantId ?? null })
    .where(eq(numero.e164, linha.e164))

  const [canal] = await db
    .select({ id: projetoCanal.id, config: projetoCanal.config })
    .from(projetoCanal)
    .where(and(eq(projetoCanal.projetoId, projetoId), eq(projetoCanal.canal, 'ligacao')))
    .limit(1)

  if (canal) {
    await db
      .update(projetoCanal)
      .set({ config: { ...canal.config, vozId: r.id } })
      .where(eq(projetoCanal.id, canal.id))
  }

  return { ok: true, vozId: r.id }
}
