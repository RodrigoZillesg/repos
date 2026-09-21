import { and, asc, eq, sql } from 'drizzle-orm'
import { numero, projeto, type Db } from '@avexa/db'

/** Frentes de trabalho dentro de um cliente.
 *
 *  Existe por causa do nome do número de telefone. Um cliente contrata duas
 *  escolas da mesma rede, ou duas campanhas, e cada frente fala de um número
 *  próprio. Chamar os dois de "International House" deixa a conta do Twilio
 *  como a antiga está hoje: uma coluna de números que ninguém sabe de quem são,
 *  descoberta só quando chega a fatura ou quando alguém liga de volta.
 *
 *  O projeto é magro de propósito. Não é um segundo tenant: fluxo, lead e
 *  execução continuam pendurados no cliente. */

export interface Projeto {
  id: string
  nome: string
  ativo: boolean
  /** Quantos números falam por esta frente. Zero significa que o projeto ainda
   *  não tem voz própria. */
  numeros: number
}

export type ResultadoProjeto =
  | { ok: true; id: string; aviso?: string }
  | { ok: false; erro: string }

/** Nome sem espaço sobrando nem espaço duplicado.
 *
 *  " Path  A " e "Path A" viram o mesmo, senão o índice único não os pega como
 *  iguais e o cliente acaba com dois projetos que se leem idênticos. */
export function normalizarNome(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ')
}

export async function listarProjetos(db: Db, clienteId: string): Promise<Projeto[]> {
  const linhas = await db
    .select({
      id: projeto.id,
      nome: projeto.nome,
      ativo: projeto.ativo,
      numeros: sql<number>`count(${numero.id})::int`,
    })
    .from(projeto)
    .leftJoin(numero, eq(numero.projetoId, projeto.id))
    .where(eq(projeto.clienteId, clienteId))
    .groupBy(projeto.id, projeto.nome, projeto.ativo, projeto.criadoEm)
    .orderBy(asc(projeto.criadoEm))
  return linhas
}

export async function criarProjeto(
  db: Db,
  clienteId: string,
  nomeBruto: string,
): Promise<ResultadoProjeto> {
  const nome = normalizarNome(nomeBruto)
  if (!nome) return { ok: false, erro: 'o projeto precisa de um nome' }
  if (nome.length > 40) {
    // O apelido do número no Twilio cabe em 64 e leva cliente e projeto. Um
    // nome gigante aqui sairia truncado lá, e truncado é pior do que curto.
    return { ok: false, erro: 'o nome do projeto cabe em 40 caracteres' }
  }

  const [ja] = await db
    .select({ id: projeto.id, ativo: projeto.ativo })
    .from(projeto)
    .where(and(eq(projeto.clienteId, clienteId), sql`lower(${projeto.nome}) = lower(${nome})`))
    .limit(1)

  if (ja) {
    // Recriar um projeto arquivado é o que a pessoa queria; recusar mandaria
    // ela procurar um botão de reativar que não existe.
    if (!ja.ativo) {
      await db.update(projeto).set({ ativo: true, nome }).where(eq(projeto.id, ja.id))
      return { ok: true, id: ja.id, aviso: 'Este projeto já existia arquivado e voltou a valer.' }
    }
    return { ok: false, erro: `este cliente já tem um projeto chamado "${nome}"` }
  }

  const [novo] = await db.insert(projeto).values({ clienteId, nome }).returning({ id: projeto.id })
  return { ok: true, id: novo!.id }
}

export async function renomearProjeto(
  db: Db,
  projetoId: string,
  nomeBruto: string,
): Promise<ResultadoProjeto> {
  const nome = normalizarNome(nomeBruto)
  if (!nome) return { ok: false, erro: 'o projeto precisa de um nome' }
  if (nome.length > 40) return { ok: false, erro: 'o nome do projeto cabe em 40 caracteres' }

  const [atual] = await db
    .select({ clienteId: projeto.clienteId })
    .from(projeto)
    .where(eq(projeto.id, projetoId))
    .limit(1)
  if (!atual) return { ok: false, erro: 'projeto não encontrado' }

  const [colisao] = await db
    .select({ id: projeto.id })
    .from(projeto)
    .where(
      and(
        eq(projeto.clienteId, atual.clienteId),
        sql`lower(${projeto.nome}) = lower(${nome})`,
        sql`${projeto.id} <> ${projetoId}`,
      ),
    )
    .limit(1)
  if (colisao) return { ok: false, erro: `este cliente já tem um projeto chamado "${nome}"` }

  await db.update(projeto).set({ nome }).where(eq(projeto.id, projetoId))

  // Renomear aqui NÃO renomeia o número no Twilio. É de propósito: o apelido lá
  // pode ter sido ajustado à mão, e sobrescrever calado apagaria essa escolha.
  // Quem quiser alinhar tem o botão de "usar o nome sugerido" na tela.
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(numero)
    .where(eq(numero.projetoId, projetoId))

  return n > 0
    ? {
        ok: true,
        id: projetoId,
        aviso:
          n === 1
            ? 'O número deste projeto continua com o nome antigo no Twilio. A tela de Números mostra a diferença.'
            : `Os ${n} números deste projeto continuam com o nome antigo no Twilio. A tela de Números mostra a diferença.`,
      }
    : { ok: true, id: projetoId }
}

/** Arquiva em vez de apagar: o número que carrega o nome dele continua no ar. */
export async function arquivarProjeto(db: Db, projetoId: string): Promise<ResultadoProjeto> {
  await db.update(projeto).set({ ativo: false }).where(eq(projeto.id, projetoId))
  return { ok: true, id: projetoId }
}
