import { and, eq, inArray, or } from 'drizzle-orm'
import { pessoa, supressao, type Db } from '@avexa/db'
import { normalizarEmail, normalizarTelefone, type Canal, type Pais } from '@avexa/core'

/** Supressão global por pessoa.
 *
 *  A regra do produto é uma só: um pedido de parada bloqueia todos os canais,
 *  para sempre, em qualquer cliente. Por isso nenhuma função aqui recebe
 *  `clienteId` como filtro — ele só entra como procedência. Se um dia alguém
 *  precisar de lista por cliente, vai ter que mudar esta camada de propósito,
 *  não por descuido. */

export interface Identificadores {
  telefone?: string | null
  email?: string | null
}

/** A pessoa está suprimida por qualquer um de seus identificadores? */
export async function estaSuprimido(db: Db, ids: Identificadores): Promise<boolean> {
  const valores: Array<{ tipo: 'telefone' | 'email'; valor: string }> = []
  if (ids.telefone) valores.push({ tipo: 'telefone', valor: ids.telefone })
  if (ids.email) valores.push({ tipo: 'email', valor: ids.email })
  if (valores.length === 0) return false

  const linhas = await db
    .select({ id: supressao.id })
    .from(supressao)
    .where(
      or(
        ...valores.map((v) => and(eq(supressao.tipo, v.tipo), eq(supressao.valor, v.valor))),
      ),
    )
    .limit(1)

  return linhas.length > 0
}

/** Grava o opt-out. Quando a pessoa tem telefone e e-mail, grava os dois: ela
 *  pediu para parar de ser contatada, não para parar de receber SMS. */
export async function suprimir(
  db: Db,
  ids: Identificadores,
  origem: { motivo: string; canal?: Canal; clienteId?: string; pessoaId?: string },
): Promise<number> {
  const linhas = [
    ...(ids.telefone ? [{ tipo: 'telefone' as const, valor: ids.telefone }] : []),
    ...(ids.email ? [{ tipo: 'email' as const, valor: ids.email }] : []),
  ].map((v) => ({
    ...v,
    motivo: origem.motivo,
    ...(origem.canal ? { canalOrigem: origem.canal } : {}),
    ...(origem.clienteId ? { clienteOrigemId: origem.clienteId } : {}),
    ...(origem.pessoaId ? { pessoaId: origem.pessoaId } : {}),
  }))

  if (linhas.length === 0) return 0

  // Repetir o opt-out não é erro: a pessoa pode mandar STOP várias vezes.
  await db.insert(supressao).values(linhas).onConflictDoNothing()
  return linhas.length
}

/** Encontra a pessoa por qualquer identificador, ou cria.
 *
 *  Dois leads de clientes diferentes com o mesmo telefone são a mesma pessoa:
 *  é isso que faz a supressão valer em todo cliente. */
export async function acharOuCriarPessoa(
  db: Db,
  bruto: { telefone?: string | null; email?: string | null },
  paisPadrao: Pais = 'AU',
): Promise<{ id: string; telefone: string | null; email: string | null }> {
  const telefone = normalizarTelefone(bruto.telefone ?? null, paisPadrao)
  const email = normalizarEmail(bruto.email ?? null)

  if (!telefone && !email) {
    throw new Error('lead sem telefone nem e-mail utilizável')
  }

  const existentes = await db
    .select()
    .from(pessoa)
    .where(
      or(
        ...(telefone ? [eq(pessoa.telefone, telefone)] : []),
        ...(email ? [eq(pessoa.email, email)] : []),
      ),
    )
    .limit(2)

  const achada = existentes[0]
  if (achada) {
    // Completa o identificador que faltava, para que o próximo opt-out por
    // qualquer canal alcance os dois.
    const faltando: Record<string, string> = {}
    if (telefone && !achada.telefone) faltando.telefone = telefone
    if (email && !achada.email) faltando.email = email
    if (Object.keys(faltando).length > 0) {
      await db.update(pessoa).set(faltando).where(eq(pessoa.id, achada.id))
    }
    return {
      id: achada.id,
      telefone: achada.telefone ?? telefone,
      email: achada.email ?? email,
    }
  }

  const [nova] = await db
    .insert(pessoa)
    .values({ telefone, email })
    .returning({ id: pessoa.id, telefone: pessoa.telefone, email: pessoa.email })

  return nova!
}

/** Busca as pessoas suprimidas dentre uma lista, para telas e relatórios. */
export async function suprimidosEntre(db: Db, valores: string[]): Promise<Set<string>> {
  if (valores.length === 0) return new Set()
  const linhas = await db
    .select({ valor: supressao.valor })
    .from(supressao)
    .where(inArray(supressao.valor, valores))
  return new Set(linhas.map((l) => l.valor))
}
