import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { agenteVoz, clienteCanal, db, numero } from '@avexa/db'
import { sessaoAtual } from '@/lib/auth'
import { clientePadrao, listarClientes } from '@/lib/dados'
import { Cartao } from '@/componentes/ui/cartao'
import { Agente } from '@/componentes/agente'
import { importarNumero, publicar, salvarAgente, type FormAgente } from './acoes'

export const dynamic = 'force-dynamic'

/** O agente de voz de um cliente.
 *
 *  Cada cliente tem o seu, e mexer num não afeta os outros — é assim que a
 *  conta da Vapi já operava, com cópias divergindo por cliente, e é o que
 *  permite ajustar um sem arriscar os demais.
 *
 *  A configuração mora aqui e é espelhada na Vapi, não o contrário: senão a
 *  tela mostraria o que acha que configurou, em vez do que está no ar. */
export default async function PaginaAgentes({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>
}) {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  if (!s.permissoes.verFluxos) redirect('/')

  const { cliente: slug } = await searchParams
  const [clientes, c] = await Promise.all([listarClientes(s), clientePadrao(s, slug)])

  if (!c) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
        <h1 className="text-xl font-semibold">Agentes de voz</h1>
        <Cartao className="mt-5">
          <p className="text-sm text-[var(--color-tinta-2)]">
            Nenhum cliente ainda. Ative um cliente com o canal de ligação para o agente dele
            nascer.
          </p>
        </Cartao>
      </div>
    )
  }

  const [a] = await db().select().from(agenteVoz).where(eq(agenteVoz.clienteId, c.id)).limit(1)

  const [linhaNumero] = await db()
    .select({ e164: numero.e164 })
    .from(numero)
    .where(and(eq(numero.clienteId, c.id), eq(numero.provedor, 'twilio')))
    .limit(1)

  const [canalVoz] = await db()
    .select({ config: clienteCanal.config })
    .from(clienteCanal)
    .where(and(eq(clienteCanal.clienteId, c.id), eq(clienteCanal.canal, 'ligacao')))
    .limit(1)

  const vozId = typeof canalVoz?.config?.vozId === 'string' ? canalVoz.config.vozId : null

  return (
    <div className="mx-auto w-full max-w-3xl p-6 lg:p-8">
      <h1 className="text-xl font-semibold">Agentes de voz</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-2)]">
        Cada cliente tem o seu agente. Ele nasce do padrão global e pode divergir a partir daí —
        ajustar um não mexe nos outros.
      </p>

      {clientes.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {clientes.map((x) => (
            <a
              key={x.id}
              href={`/agentes?cliente=${x.slug}`}
              className={`rounded-lg border px-3 py-1.5 text-[13px] ${
                x.id === c.id ? 'border-[var(--color-acento)]' : ''
              }`}
            >
              {x.nome}
            </a>
          ))}
        </div>
      )}

      {!a ? (
        <Cartao className="mt-5">
          <p className="text-sm text-[var(--color-tinta-2)]">
            <strong>{c.nome}</strong> ainda não tem agente de voz. Ele é criado na ativação quando o
            canal de ligação está contratado.
          </p>
        </Cartao>
      ) : (
        <div className="mt-5">
          <Agente
            inicial={
              {
                id: a.id,
                nome: a.nome,
                idioma: a.idioma,
                modeloProvedor: a.modeloProvedor,
                modelo: a.modelo,
                prompt: a.prompt,
                primeiraMensagem: a.primeiraMensagem,
                mensagemEncerramento: a.mensagemEncerramento,
                mensagemCaixaPostal: a.mensagemCaixaPostal ?? '',
                provedorVoz: a.provedorVoz,
                vozId: a.vozId,
                modeloVoz: a.modeloVoz ?? '',
                transcritor: a.transcritor,
                modeloTranscritor: a.modeloTranscritor ?? '',
              } satisfies FormAgente
            }
            clienteId={c.id}
            clienteNome={c.nome}
            podeAdministrar={s.permissoes.administrar}
            publicado={!!a.vapiAssistantId}
            // Salvo depois de publicado significa mudança que ainda não saiu
            // daqui — a diferença que o operador precisa ver antes de ligar.
            pendente={!a.publicadoEm || a.atualizadoEm > a.publicadoEm}
            numero={linhaNumero?.e164 ?? null}
            vozIdNaVapi={vozId}
            aoSalvar={salvarAgente}
            aoPublicar={publicar}
            aoImportarNumero={importarNumero}
          />
        </div>
      )}
    </div>
  )
}
