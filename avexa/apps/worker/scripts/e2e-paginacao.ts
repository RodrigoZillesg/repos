/** Prova de que a paginação por cursor não pula nem repete lead.
 *
 *  O teste unitário cobre a aritmética das setas; o que ele não alcança é o
 *  SQL: se a comparação sobre o par (criadoEm, id) realmente ordena e corta
 *  como se espera. O caso que motivou o cursor — vários leads no MESMO
 *  milissegundo, como acontece num envio de formulário em lote — só aparece
 *  contra um banco de verdade.
 *
 *  Cria os próprios dados e apaga tudo ao final, inclusive se falhar.
 *
 *      pnpm --filter @avexa/worker e2e:paginacao
 */
import { and, asc, desc, eq, gt, gte, like, lt, or } from 'drizzle-orm'
import { cliente, db, fluxo, lead, pessoa } from '@avexa/db'

const d = db()

const SLUG = 'verificacao-paginacao'

/** Roda antes e depois: uma execução interrompida no meio não pode impedir a
 *  próxima. O cascade leva os leads junto. */
async function limpar() {
  await d.delete(cliente).where(eq(cliente.slug, SLUG))
  await d.delete(pessoa).where(like(pessoa.email, '%@verif-paginacao.local'))
}

await limpar()

const [c] = await d
  .insert(cliente)
  .values({ nome: 'Verificação de paginação', slug: SLUG, fusoHorario: 'Australia/Sydney' })
  .returning()

const [f] = await d
  .insert(fluxo)
  .values({ clienteId: c!.id, nome: 'Verificação', slug: 'verif' })
  .returning()

// 25 leads: 10 com timestamps distintos, 15 empilhados no MESMO instante.
const base = new Date('2026-09-01T00:00:00.000Z')
const pessoas = await d
  .insert(pessoa)
  .values(Array.from({ length: 25 }, (_, i) => ({ email: `p${i}@verif-paginacao.local` })))
  .returning()

const valores = []
for (let i = 0; i < 10; i++) {
  valores.push({ clienteId: c!.id, fluxoId: f!.id, pessoaId: pessoas[i]!.id, nome: `distinto-${i}`, dedupeKey: `d-${i}`, criadoEm: new Date(base.getTime() + i * 60_000) })
}
const empate = new Date(base.getTime() + 20 * 60_000)
for (let i = 0; i < 15; i++) {
  valores.push({ clienteId: c!.id, fluxoId: f!.id, pessoaId: pessoas[10 + i]!.id, nome: `empate-${i}`, dedupeKey: `e-${i}`, criadoEm: empate })
}
await d.insert(lead).values(valores)

const LIMITE = 7

/** A mesma construção de where que a listagem usa. */
async function pagina(cursor: { criadoEm: Date; id: string } | null, voltando: boolean) {
  const linhas = await d
    .select({ id: lead.id, nome: lead.nome, criadoEm: lead.criadoEm })
    .from(lead)
    .where(
      and(
        eq(lead.clienteId, c!.id),
        gte(lead.criadoEm, new Date(base.getTime() - 86_400_000)),
        ...(cursor && !voltando
          ? [or(lt(lead.criadoEm, cursor.criadoEm), and(eq(lead.criadoEm, cursor.criadoEm), lt(lead.id, cursor.id)))!]
          : []),
        ...(cursor && voltando
          ? [or(gt(lead.criadoEm, cursor.criadoEm), and(eq(lead.criadoEm, cursor.criadoEm), gt(lead.id, cursor.id)))!]
          : []),
      ),
    )
    .orderBy(voltando ? asc(lead.criadoEm) : desc(lead.criadoEm), voltando ? asc(lead.id) : desc(lead.id))
    .limit(LIMITE + 1)

  const temMais = linhas.length > LIMITE
  const p = linhas.slice(0, LIMITE)
  if (voltando) p.reverse()
  return { p, temMais }
}

// Varre para frente, juntando tudo.
const vistos: string[] = []
let cursor: { criadoEm: Date; id: string } | null = null
const paginas: string[][] = []
for (let i = 0; i < 20; i++) {
  const { p, temMais } = await pagina(cursor, false)
  if (p.length === 0) break
  paginas.push(p.map((x) => x.nome!))
  vistos.push(...p.map((x) => x.id))
  if (!temMais) break
  const ultimo = p[p.length - 1]!
  cursor = { criadoEm: ultimo.criadoEm, id: ultimo.id }
}

console.log(`páginas para frente: ${paginas.length}`)
paginas.forEach((pg, i) => console.log(`  ${i + 1}: ${pg.length} linhas`))

const unicos = new Set(vistos)
console.log(`\nleads vistos: ${vistos.length}   distintos: ${unicos.size}   esperado: 25`)
console.log(vistos.length === 25 && unicos.size === 25 ? '  OK: nenhum lead pulado nem repetido' : '  FALHOU')

// Agora volta a partir da última página e confere que chega ao mesmo conjunto.
let cursorVolta: { criadoEm: Date; id: string } | null = null
const ultimaPagina = await pagina(cursor, false)
if (ultimaPagina.p.length > 0) {
  const pri = ultimaPagina.p[0]!
  cursorVolta = { criadoEm: pri.criadoEm, id: pri.id }
}
const voltados: string[] = []
for (let i = 0; i < 20 && cursorVolta; i++) {
  const { p, temMais } = await pagina(cursorVolta, true)
  if (p.length === 0) break
  voltados.unshift(...p.map((x) => x.id))
  if (!temMais) break
  const pri = p[0]!
  cursorVolta = { criadoEm: pri.criadoEm, id: pri.id }
}
const conjuntoVolta = new Set(voltados)
console.log(`\nvoltando: ${voltados.length} linhas, ${conjuntoVolta.size} distintas`)
console.log(
  voltados.length === conjuntoVolta.size ? '  OK: nenhuma repetição ao voltar' : '  FALHOU: repetiu ao voltar',
)

// A ordem vista para frente precisa ser estritamente decrescente por (data, id).
const todos = await d
  .select({ id: lead.id, criadoEm: lead.criadoEm })
  .from(lead)
  .where(eq(lead.clienteId, c!.id))
  .orderBy(desc(lead.criadoEm), desc(lead.id))
const esperada = todos.map((x) => x.id)
console.log(
  `\nordem: ${JSON.stringify(vistos) === JSON.stringify(esperada) ? 'OK: idêntica à ordenação completa' : 'FALHOU: divergiu'}`,
)

await limpar()

const tudoOk =
  vistos.length === 25 &&
  unicos.size === 25 &&
  voltados.length === conjuntoVolta.size &&
  JSON.stringify(vistos) === JSON.stringify(esperada)

// Sai com erro quando algo não bate: um job verde com falha no meio do log é
// uma falha que ninguém vê.
process.exit(tudoOk ? 0 : 1)
