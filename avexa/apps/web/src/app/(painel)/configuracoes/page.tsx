import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { configGlobal, db } from '@avexa/db'
import { LIMITES_PADRAO } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'
import { Configuracoes } from '@/componentes/configuracoes'
import { salvarAjustes, type Ajustes } from './acoes'

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
    </div>
  )
}
