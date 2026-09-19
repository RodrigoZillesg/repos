'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, template } from '@avexa/db'
import { variaveisDe } from '@avexa/core'
import { requisitar } from '@avexa/adapters'
import { sessaoAtual } from '@/lib/auth'

const hashTexto = (v: string) => createHash('sha256').update(v.trim()).digest('hex')

export interface EntradaTemplate {
  id: string
  nome: string
  assunto: string | null
  corpo: string
  variaveis: Record<string, string>
}

/** Salva um template.
 *
 *  A regra que o artefato enuncia e que o produto precisa cumprir: trocar o
 *  valor de uma variável não exige nova aprovação; mudar o texto fixo, sim.
 *  Comparamos o hash do corpo contra o hash aprovado — sem isso, alguém editaria
 *  o texto de um template já aprovado e continuaríamos mandando à Meta uma coisa
 *  e para o lead outra. */
export async function salvarTemplate(
  entrada: EntradaTemplate,
): Promise<{ ok: boolean; erro?: string; statusNovo?: string }> {
  const s = await sessaoAtual()
  if (!s) return { ok: false, erro: 'sem sessão' }

  const d = db()
  const [atual] = await d.select().from(template).where(eq(template.id, entrada.id)).limit(1)
  if (!atual) return { ok: false, erro: 'template não encontrado' }

  if (!s.permissoes.templates.includes(atual.canal as 'email')) {
    return { ok: false, erro: 'sem permissão para este canal' }
  }

  const textoMudou = hashTexto(entrada.corpo) !== atual.hashAprovado
  // Só o WhatsApp passa pela Meta. E-mail e SMS são nossos: seguem aprovados.
  const perdeAprovacao = atual.canal === 'whatsapp' && atual.status === 'aprovado' && textoMudou

  await d
    .update(template)
    .set({
      nome: entrada.nome,
      assunto: entrada.assunto,
      corpo: entrada.corpo,
      variaveis: entrada.variaveis,
      atualizadoEm: new Date(),
      ...(perdeAprovacao ? { status: 'rascunho', metaTemplateId: null, metaStatus: null } : {}),
      ...(atual.canal !== 'whatsapp'
        ? { status: 'aprovado' as const, hashAprovado: hashTexto(entrada.corpo) }
        : {}),
    })
    .where(eq(template.id, entrada.id))

  revalidatePath('/templates')
  return {
    ok: true,
    ...(perdeAprovacao ? { statusNovo: 'rascunho' } : {}),
  }
}

/** Submete um template de WhatsApp à Meta e guarda o status do retorno.
 *
 *  O nó que referencia o template só libera envio quando ele estiver aprovado —
 *  a regra vive no motor, aqui só registramos o que a Meta respondeu. */
export async function submeterAMeta(templateId: string): Promise<{ ok: boolean; erro?: string }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.templates.includes('whatsapp')) return { ok: false, erro: 'sem permissão' }

  const d = db()
  const [t] = await d.select().from(template).where(eq(template.id, templateId)).limit(1)
  if (!t || t.canal !== 'whatsapp') return { ok: false, erro: 'template inválido' }

  const wabaId = process.env.WHATSAPP_WABA_ID
  const token = process.env.WHATSAPP_TOKEN
  if (!wabaId || !token) return { ok: false, erro: 'WhatsApp não configurado neste ambiente' }

  // A Cloud API recebe as variáveis por posição: {{1}}, {{2}}. Traduzimos os
  // nomes na ordem em que aparecem no corpo.
  const nomes = variaveisDe(t.corpo)
  let corpoMeta = t.corpo
  nomes.forEach((nome, i) => {
    corpoMeta = corpoMeta.replaceAll(
      new RegExp(`\\{\\{\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'),
      `{{${i + 1}}}`,
    )
  })

  const nomeMeta = t.nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 60)

  const r = await requisitar(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    cabecalhos: { authorization: `Bearer ${token}` },
    corpo: {
      name: nomeMeta,
      language: t.idioma === 'pt-BR' ? 'pt_BR' : 'en',
      category: 'MARKETING',
      components: [
        {
          type: 'BODY',
          text: corpoMeta,
          ...(nomes.length
            ? { example: { body_text: [nomes.map((n) => t.variaveis[n] ?? n)] } }
            : {}),
        },
      ],
    },
  })

  if (!r.ok) {
    const e = (r.corpo as { error?: { message?: string } } | null)?.error
    await d
      .update(template)
      .set({ status: 'rejeitado', metaMotivoRejeicao: e?.message ?? r.erro ?? 'falha na submissão' })
      .where(eq(template.id, templateId))
    revalidatePath('/templates')
    return { ok: false, erro: e?.message ?? r.erro ?? '' }
  }

  const resposta = r.corpo as { id?: string; status?: string } | null
  const aprovado = resposta?.status === 'APPROVED'

  await d
    .update(template)
    .set({
      // A Meta costuma devolver PENDING e aprovar depois, por webhook. Só
      // marcamos aprovado quando ela diz que está.
      status: aprovado ? 'aprovado' : 'pendente',
      metaTemplateId: nomeMeta,
      metaStatus: resposta?.status ?? 'PENDING',
      metaSubmetidoEm: new Date(),
      metaMotivoRejeicao: null,
      ...(aprovado ? { hashAprovado: hashTexto(t.corpo) } : {}),
    })
    .where(eq(template.id, templateId))

  revalidatePath('/templates')
  return { ok: true }
}
