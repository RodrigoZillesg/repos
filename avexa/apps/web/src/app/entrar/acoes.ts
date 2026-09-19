'use server'

import { headers } from 'next/headers'
import { pedirLink } from '@/lib/auth'
import { basePublica } from '@/lib/url'

export async function solicitarLink(_estado: unknown, form: FormData): Promise<{ enviado: boolean }> {
  const email = String(form.get('email') ?? '')
  if (!email.includes('@')) return { enviado: false }

  await pedirLink(email, basePublica(await headers()))
  // Sempre "enviado", mesmo para e-mail desconhecido: a resposta não pode
  // revelar quem tem acesso ao painel.
  return { enviado: true }
}
