'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { agenteVoz, auditoria, db, projeto } from '@avexa/db'
import {
  credenciaisDoAmbiente,
  credenciaisVapiDoAmbiente,
  importarNumeroDoProjeto,
  publicarAgente,
  segredoDoWebhookDeVoz,
  webhookDeLigacao,
} from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

/** Edição do agente de voz de um cliente.
 *
 *  Guardar e publicar são ações separadas de propósito. Guardar é barato e
 *  reversível; publicar muda o que sai na boca de quem liga para um lead
 *  daqui a um minuto. Quem escreve um prompt quer salvar rascunho várias vezes
 *  e publicar uma. */

export interface FormAgente {
  id: string
  nome: string
  idioma: string
  modeloProvedor: string
  modelo: string
  prompt: string
  primeiraMensagem: string
  mensagemEncerramento: string
  mensagemCaixaPostal: string
  provedorVoz: string
  vozId: string
  modeloVoz: string
  transcritor: string
  modeloTranscritor: string
}

export interface Resultado {
  ok: boolean
  erro?: string
  aviso?: string
}

/** O que o operador não pode remover do prompt, por não ser preferência.
 *
 *  Divulgação de IA e gravação são obrigação em boa parte dos lugares onde os
 *  clientes ligam, e o aviso de opt-out é o que impede o motor de continuar
 *  procurando quem pediu para parar. Um prompt sem isso passa pela revisão de
 *  ninguém e só aparece numa reclamação. */
function faltandoNoPrompt(prompt: string): string[] {
  const p = prompt.toLowerCase()
  const falta: string[] = []
  if (!/\b(ia|a\.i\.|inteligência artificial|ai assistant|assistente)\b/.test(p)) {
    falta.push('a divulgação de que é um assistente de IA')
  }
  if (!/(grava|record)/.test(p)) falta.push('o aviso de que a ligação pode ser gravada')
  if (!/(opt-?out|pare de ligar|não me|stop calling|remove me|lista)/.test(p)) {
    falta.push('o tratamento de opt-out')
  }
  return falta
}

export async function salvarAgente(f: FormAgente): Promise<Resultado> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  if (!f.prompt.trim()) return { ok: false, erro: 'o agente precisa de um prompt' }
  if (!f.primeiraMensagem.trim()) {
    return { ok: false, erro: 'a primeira fala é o que o lead ouve primeiro: não pode ficar vazia' }
  }
  if (!f.modelo.trim()) return { ok: false, erro: 'escolha um modelo' }

  const [antes] = await db().select().from(agenteVoz).where(eq(agenteVoz.id, f.id)).limit(1)
  if (!antes) return { ok: false, erro: 'agente não encontrado' }

  await db()
    .update(agenteVoz)
    .set({
      nome: f.nome.trim(),
      idioma: f.idioma.trim() || 'en',
      modeloProvedor: f.modeloProvedor.trim(),
      modelo: f.modelo.trim(),
      prompt: f.prompt,
      primeiraMensagem: f.primeiraMensagem.trim(),
      mensagemEncerramento: f.mensagemEncerramento.trim() || 'Have a great day!',
      mensagemCaixaPostal: f.mensagemCaixaPostal.trim() || null,
      provedorVoz: f.provedorVoz.trim(),
      vozId: f.vozId.trim(),
      modeloVoz: f.modeloVoz.trim() || null,
      transcritor: f.transcritor.trim(),
      modeloTranscritor: f.modeloTranscritor.trim() || null,
      atualizadoEm: new Date(),
      atualizadoPor: s.usuarioId,
    })
    .where(eq(agenteVoz.id, f.id))

  // O prompt decide o que uma IA vai dizer a uma pessoa de verdade. Quem mudou
  // e o que mudou fica registrado.
  // O agente é do projeto; a auditoria continua no eixo do cliente, que é como
  // se lê histórico. O projeto vai no detalhe.
  const [dono] = await db()
    .select({ clienteId: projeto.clienteId })
    .from(projeto)
    .where(eq(projeto.id, antes.projetoId))
    .limit(1)

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    ...(dono ? { clienteId: dono.clienteId } : {}),
    acao: 'agente.salvar',
    entidade: 'agente_voz',
    entidadeId: f.id,
    detalhe: {
      projetoId: antes.projetoId,
      promptAntes: antes.prompt,
      promptDepois: f.prompt,
      modelo: f.modelo,
    },
  })

  revalidatePath('/agentes')

  const falta = faltandoNoPrompt(f.prompt)
  return {
    ok: true,
    ...(falta.length
      ? { aviso: `Salvo, mas o prompt parece não conter ${falta.join(', ')}.` }
      : {}),
  }
}

/** Espelha na Vapi o que está salvo aqui. É o que muda a ligação de verdade. */
export async function publicar(agenteId: string): Promise<Resultado> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  const vapi = credenciaisVapiDoAmbiente()
  if (!vapi) return { ok: false, erro: 'VAPI_API_KEY não está configurada no servidor' }

  const r = await publicarAgente(db(), agenteId, vapi, webhookDeLigacao(), segredoDoWebhookDeVoz())
  if (!r.ok) return { ok: false, erro: r.erro }

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    acao: 'agente.publicar',
    entidade: 'agente_voz',
    entidadeId: agenteId,
    detalhe: { vapiAssistantId: r.vapiAssistantId },
  })

  revalidatePath('/agentes')
  return { ok: true }
}

/** Leva o número do cliente para a Vapi e o liga ao agente.
 *
 *  Separado do publicar porque falha por motivos diferentes: publicar depende
 *  do agente, importar depende de o cliente ter número. */
export async function importarNumero(clienteId: string): Promise<Resultado> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  const vapi = credenciaisVapiDoAmbiente()
  const twilio = credenciaisDoAmbiente()
  if (!vapi) return { ok: false, erro: 'VAPI_API_KEY não está configurada no servidor' }
  if (!twilio) return { ok: false, erro: 'as credenciais do Twilio não estão configuradas' }

  const r = await importarNumeroDoProjeto(db(), clienteId, vapi, twilio)
  if (!r.ok) return { ok: false, erro: r.erro }

  revalidatePath('/agentes')
  return { ok: true }
}
