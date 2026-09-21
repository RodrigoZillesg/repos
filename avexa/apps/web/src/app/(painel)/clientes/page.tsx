import { redirect } from 'next/navigation'
import { db } from '@avexa/db'
import { estadoDosCanais, listarProjetos, type CadastroDoCliente } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { clientePadrao, listarClientes } from '@/lib/dados'
import { Cartao } from '@/componentes/ui/cartao'
import { Cliente } from '@/componentes/cliente'
import { Projetos } from '@/componentes/projetos'
import {
  alternarCanal,
  arquivarProjetoAcao,
  criarProjetoAcao,
  renomearProjetoAcao,
  salvarCadastro,
} from './acoes'

export const dynamic = 'force-dynamic'

/** O cliente depois de ativado.
 *
 *  A ativação era a única chance de decidir canal, fuso e modo seco. Isso
 *  bastava enquanto nada tinha entrado no ar — mas cliente contrata SMS no
 *  segundo mês, desiste de ligação, e alguém erra o fuso no cadastro. */
export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verClientes) redirect('/')

  const { cliente: slug } = await searchParams
  const [clientes, c] = await Promise.all([listarClientes(s), clientePadrao(s, slug)])

  if (!c) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
        <h1 className="text-xl font-semibold">Clientes</h1>
        <Cartao className="mt-5">
          <p className="text-sm text-[var(--color-tinta-2)]">
            Nenhum cliente ainda. Comece por <strong>Ativar cliente</strong>.
          </p>
        </Cartao>
      </div>
    )
  }

  const [canais, projetos] = await Promise.all([estadoDosCanais(db(), c.id), listarProjetos(db(), c.id)])

  return (
    <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Clientes</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        O que foi decidido na ativação e pode mudar depois. Canal contratado, fuso, país e se os
        contatos saem de verdade.
      </p>

      {clientes.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {clientes.map((x) => (
            <a
              key={x.id}
              href={`/clientes?cliente=${x.slug}`}
              className={`rounded-lg border px-3 py-1.5 text-[13px] ${
                x.id === c.id ? 'border-[var(--color-acento)] text-[var(--color-acento)]' : ''
              }`}
            >
              {x.nome}
            </a>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Cliente
          clienteId={c.id}
          slug={c.slug}
          inicial={
            {
              nome: c.nome,
              fusoHorario: c.fusoHorario,
              pais: c.pais,
              dryRun: c.dryRun,
            } satisfies CadastroDoCliente
          }
          canais={canais}
          podeAdministrar={s.permissoes.administrar}
          aoSalvar={salvarCadastro}
          aoAlternarCanal={alternarCanal}
        />
      </div>

      <div className="mt-4">
        <Projetos
          clienteId={c.id}
          projetos={projetos}
          podeAdministrar={s.permissoes.administrar}
          aoCriar={criarProjetoAcao}
          aoRenomear={renomearProjetoAcao}
          aoArquivar={arquivarProjetoAcao}
        />
      </div>
    </div>
  )
}
