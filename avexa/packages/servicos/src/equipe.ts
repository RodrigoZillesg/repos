import { and, eq, ne } from 'drizzle-orm'
import { papelEnum, usuario, type Db } from '@avexa/db'

/** Quem tem acesso ao painel.
 *
 *  Até aqui, usuário só nascia no seed: dar acesso a um cliente significava
 *  alguém abrir o banco e escrever um INSERT à mão. Isso é ruim por dois
 *  motivos, e o segundo é o pior — um INSERT não deixa registro de quem
 *  decidiu, e criar usuário é decidir quem enxerga os leads de uma empresa.
 *
 *  As regras vivem aqui e não na tela porque a tela não é controle de acesso:
 *  o painel e os scripts do worker chamam as mesmas funções. */

/** Derivado do enum do banco, não redigitado: uma cópia manual desta união é
 *  como nasce a divergência que só aparece quando o INSERT falha. */
export type Papel = (typeof papelEnum.enumValues)[number]

export const PAPEIS = papelEnum.enumValues

export interface Convite {
  email: string
  nome: string
  papel: Papel
  /** Obrigatório para o papel `cliente`, proibido para os outros. */
  clienteId?: string | null
  idioma?: 'pt-BR' | 'en'
}

export interface UsuarioCriado {
  id: string
  email: string
  nome: string
  papel: Papel
  clienteId: string | null
}

export type ResultadoConvite = { ok: true; usuario: UsuarioCriado } | { ok: false; erro: string }

const normalizar = (v: string) => v.trim().toLowerCase()

/** Suficiente para pegar o erro que importa — endereço sem arroba ou com
 *  espaço no meio. Validação de e-mail por regex completa não existe, e a
 *  prova real é o link chegar. */
const ENDERECO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function convidarUsuario(db: Db, c: Convite): Promise<ResultadoConvite> {
  const email = normalizar(c.email)
  const nome = c.nome.trim()

  if (!ENDERECO.test(email)) return { ok: false, erro: 'endereço de e-mail inválido' }
  if (!nome) return { ok: false, erro: 'o convite precisa de um nome' }

  // O vínculo com o cliente não é detalhe de formulário: é o que separa "vê os
  // próprios leads" de "não vê nada". Um usuário `cliente` sem clienteId entra
  // no painel e encontra uma tela vazia, sem erro nenhum que explique o porquê.
  if (c.papel === 'cliente' && !c.clienteId) {
    return { ok: false, erro: 'um usuário do tipo cliente precisa estar ligado a um cliente' }
  }
  // E o contrário também: vincular um admin a um cliente sugere um escopo que
  // o papel não aplica. Quem lesse a lista depois acharia que aquele admin só
  // enxerga aquele cliente.
  if (c.papel !== 'cliente' && c.clienteId) {
    return { ok: false, erro: `o papel ${c.papel} não é ligado a um cliente específico` }
  }

  const [existente] = await db.select().from(usuario).where(eq(usuario.email, email)).limit(1)
  if (existente) {
    // Aqui a verdade é dita, ao contrário da tela de login: quem convida é
    // admin e precisa saber que o endereço já está em uso — inclusive quando o
    // usuário existe desativado, que é o caso mais confuso de todos.
    return {
      ok: false,
      erro: existente.ativo
        ? `${email} já tem acesso ao painel`
        : `${email} já existe, mas está desativado. Reative em vez de convidar de novo.`,
    }
  }

  const [criado] = await db
    .insert(usuario)
    .values({
      email,
      nome,
      papel: c.papel,
      clienteId: c.papel === 'cliente' ? (c.clienteId ?? null) : null,
      idioma: c.idioma ?? 'pt-BR',
    })
    .returning()

  if (!criado) return { ok: false, erro: 'não foi possível criar o usuário' }

  return {
    ok: true,
    usuario: {
      id: criado.id,
      email: criado.email,
      nome: criado.nome,
      papel: criado.papel as Papel,
      clienteId: criado.clienteId,
    },
  }
}

/** Liga e desliga o acesso sem apagar nada.
 *
 *  Desativar em vez de excluir: excluir levaria junto os tokens e apagaria da
 *  auditoria a ligação com quem fez o quê. E `emitirLinkDeAcesso` já recusa
 *  usuário inativo, então desativar fecha a porta de verdade — não é só uma
 *  marca na lista. */
export async function definirAtivo(
  db: Db,
  usuarioId: string,
  ativo: boolean,
): Promise<{ ok: boolean; erro?: string }> {
  const [alvo] = await db.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1)
  if (!alvo) return { ok: false, erro: 'usuário não encontrado' }

  // Desativar o último admin ativo tranca todo mundo do lado de fora, e não há
  // tela no painel para desfazer — só acesso ao banco.
  if (!ativo && alvo.papel === 'admin') {
    const outros = await db
      .select({ id: usuario.id })
      .from(usuario)
      .where(and(eq(usuario.papel, 'admin'), eq(usuario.ativo, true), ne(usuario.id, usuarioId)))
    if (outros.length === 0) {
      return { ok: false, erro: 'este é o último admin ativo — desativá-lo tranca o painel' }
    }
  }

  await db.update(usuario).set({ ativo }).where(eq(usuario.id, usuarioId))
  return { ok: true }
}
