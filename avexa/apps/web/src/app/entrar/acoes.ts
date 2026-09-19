'use server'

import { headers } from 'next/headers'
import { pedirLink } from '@/lib/auth'

export async function solicitarLink(_estado: unknown, form: FormData): Promise<{ enviado: boolean }> {
  const email = String(form.get('email') ?? '')
  if (!email.includes('@')) return { enviado: false }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('host') ?? 'localhost:3000'

  await pedirLink(email, `${proto}://${host}`)
  // Sempre "enviado", mesmo para e-mail desconhecido: a resposta não pode
  // revelar quem tem acesso ao painel.
  return { enviado: true }
}
