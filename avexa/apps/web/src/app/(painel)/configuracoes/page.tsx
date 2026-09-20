import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { cliente, configGlobal, db, usuario } from '@avexa/db'
import { LIMITES_PADRAO } from '@avexa/core'
import { PAPEIS } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { DESCRICAO_PAPEL } from '@/lib/papeis'
import { Configuracoes } from '@/componentes/configuracoes'
import { Acesso, type UsuarioNaLista } from '@/componentes/acesso'
import { alternarAcesso, convidar, reenviar, salvarAjustes, type Ajustes } from './acoes'

export const dynamic = 'force-dynamic'

/** Limites do motor e retenção de dados.
 *
 *  Os dois estavam no banco desde o começo — os limites sendo lidos pelo motor,
 *  a retenção sem ninguém ler. Esta tela é onde as duas coisas deixam de ser
 *  configuração escondida num INSERT. */
export default async function PaginaConfiguracoes() {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  // Operação enxerga para entender por que um fluxo parou; só admin altera.
  if (!s.permissoes.verFluxos) redirect('/')

  const [linha] = await db().select().from(configGlobal).where(eq(configGlobal.id, 1)).limit(1)

  const inicial: Ajustes = {
    tetoTentativas: linha?.tetoTentativas ?? LIMITES_PADRAO.tetoTentativas,
    janelaInicioMin: linha?.janelaInicioMin ?? LIMITES_PADRAO.janelaInicioMin,
    janelaFimMin: linha?.janelaFimMin ?? LIMITES_PADRAO.janelaFimMin,
    contatarSabado: linha?.contatarSabado ?? LIMITES_PADRAO.contatarSabado,
    contatarDomingo: linha?.contatarDomingo ?? LIMITES_PADRAO.contatarDomingo,
    intervaloMinimoMin: linha?.intervaloMinimoMin ?? LIMITES_PADRAO.intervaloMinimoMin,
    profundidadeMaxSubfluxo:
      linha?.profundidadeMaxSubfluxo ?? LIMITES_PADRAO.profundidadeMaxSubfluxo,
    retencaoLeadDias: linha?.retencaoLeadDias ?? 0,
    retencaoGravacaoDias: linha?.retencaoGravacaoDias ?? 0,
  }

  // Quem administra também administra o acesso. Operação enxerga a lista para
  // saber a quem pedir, mas os botões não obedecem a ela — a checagem está na
  // ação, no servidor, não em esconder o botão.
  const linhasUsuario = await db()
    .select({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      ativo: usuario.ativo,
      ultimoAcessoEm: usuario.ultimoAcessoEm,
      cliente: cliente.nome,
    })
    .from(usuario)
    .leftJoin(cliente, eq(usuario.clienteId, cliente.id))
    .orderBy(asc(usuario.nome))

  const usuarios: UsuarioNaLista[] = linhasUsuario.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    cliente: u.cliente,
    ativo: u.ativo,
    ultimoAcessoEm: u.ultimoAcessoEm,
    souEu: u.id === s.usuarioId,
  }))

  const clientes = await db()
    .select({ id: cliente.id, nome: cliente.nome })
    .from(cliente)
    .orderBy(asc(cliente.nome))

  const papeis = PAPEIS.map((p) => ({
    valor: p,
    rotulo: p,
    descricao: DESCRICAO_PAPEL[p][s.idioma === 'en' ? 'en' : 'pt'],
  }))

  return (
    <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Configurações</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        Estes valores valem para todos os clientes e todos os fluxos. São as regras que o motor
        aplica sozinho, mesmo quando o fluxo pede outra coisa.
      </p>

      {linha?.atualizadoEm && (
        <p className="mt-2 text-xs text-[var(--color-tinta-3)]">
          Última alteração em {linha.atualizadoEm.toISOString().slice(0, 16).replace('T', ' ')}.
        </p>
      )}

      <div className="mt-5">
        <Configuracoes
          inicial={inicial}
          podeAdministrar={s.permissoes.administrar}
          aoSalvar={salvarAjustes}
        />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Acesso ao painel</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        Quem entra, com qual papel e — no caso do cliente final — de qual cliente. Esta é a única
        forma de dar acesso: nada de conta criada por fora.
      </p>

      <div className="mt-5">
        <Acesso
          usuarios={usuarios}
          clientes={clientes}
          papeis={papeis}
          podeAdministrar={s.permissoes.administrar}
          aoConvidar={convidar}
          aoReenviar={reenviar}
          aoAlternar={alternarAcesso}
        />
      </div>
    </div>
  )
}
