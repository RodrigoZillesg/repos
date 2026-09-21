import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { cliente as clienteT, db, projeto as projetoT } from '@avexa/db'
import { credenciaisDoAmbiente, inventarioDeNumeros } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { Cartao } from '@/componentes/ui/cartao'
import { Numeros } from '@/componentes/numeros'
import { adotarNumeroAcao, renomearNumeroAcao } from './acoes'

export const dynamic = 'force-dynamic'

/** Os números reais da conta do Twilio.
 *
 *  A pergunta que esta tela responde é "de quem é este número?". Hoje ela só
 *  tem resposta no console do Twilio, e lá a resposta é o FriendlyName — que na
 *  conta antiga foi preenchido por quem lembrou. */
export default async function PaginaNumeros() {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verClientes) redirect('/')

  const cred = credenciaisDoAmbiente()
  if (!cred) {
    return (
      <Moldura>
        <Cartao className="mt-5">
          <p className="text-sm text-[var(--color-tinta-2)]">
            O Twilio não está configurado neste ambiente. Sem{' '}
            <code className="font-mono text-xs">TWILIO_ACCOUNT_SID</code> e{' '}
            <code className="font-mono text-xs">TWILIO_AUTH_TOKEN</code> não há conta para ler.
          </p>
        </Cartao>
      </Moldura>
    )
  }

  const d = db()
  const [inventario, clientes] = await Promise.all([
    inventarioDeNumeros(d, cred),
    d.select({ id: clienteT.id, nome: clienteT.nome }).from(clienteT).orderBy(asc(clienteT.nome)),
  ])

  if (!inventario.ok) {
    // Falha de leitura aparece como falha, não como lista vazia. Uma lista
    // vazia aqui seria lida como "não temos número nenhum".
    return (
      <Moldura>
        <Cartao className="mt-5">
          <p className="text-sm text-[var(--color-perigo)]">
            Não deu para ler a conta do Twilio: {inventario.erro}
          </p>
          <p className="mt-2 text-xs text-[var(--color-tinta-3)]">
            Esta tela não mostra cópia guardada. Enquanto o Twilio não responder, não há como dizer
            quais números a conta tem — e um lista vazia seria mentira.
          </p>
        </Cartao>
      </Moldura>
    )
  }

  const projetos = await d
    .select({ id: projetoT.id, nome: projetoT.nome, clienteId: projetoT.clienteId })
    .from(projetoT)
    .where(eq(projetoT.ativo, true))
    .orderBy(asc(projetoT.criadoEm))

  return (
    <Moldura>
      <div className="mt-5">
        <Numeros
          numeros={inventario.numeros}
          clientes={clientes.map((c) => ({
            ...c,
            projetos: projetos.filter((p) => p.clienteId === c.id).map(({ id, nome }) => ({ id, nome })),
          }))}
          podeAdministrar={s.permissoes.administrar}
          aoRenomear={renomearNumeroAcao}
          aoAdotar={adotarNumeroAcao}
        />
      </div>
    </Moldura>
  )
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Números</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        O que a conta do Twilio tem de verdade, lido agora. O nome de cada número é a única
        identificação que viaja com ele: aparece no console, na fatura e em qualquer ferramenta que
        leia a conta.
      </p>
      {children}
    </div>
  )
}
