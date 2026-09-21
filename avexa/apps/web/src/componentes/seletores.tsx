import Link from 'next/link'

/** Seletores de cliente e de projeto, no topo das telas de operação.
 *
 *  O projeto aparece porque quase tudo que estas telas mostram é dele: número,
 *  canais, templates, fluxos e destino de entrega. Um cliente com duas escolas
 *  tem dois conjuntos disso, e sem o seletor a tela mostraria um deles sem
 *  dizer qual.
 *
 *  Some quando só há um, dos dois lados: uma fileira com uma opção só não é
 *  escolha, é ruído em cima de toda tela. */

interface Item {
  id: string
  nome: string
  slug: string
}

export function Seletores({
  base,
  clientes,
  clienteAtual,
  projetos,
  projetoAtual,
}: {
  /** Caminho da tela, para montar os links. */
  base: string
  clientes: Item[]
  clienteAtual: string
  projetos: Item[]
  projetoAtual: string | null
}) {
  const mostraCliente = clientes.length > 1
  const mostraProjeto = projetos.length > 1
  if (!mostraCliente && !mostraProjeto) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {mostraCliente && (
        <Fileira
          rotulo="Cliente"
          itens={clientes}
          atual={clienteAtual}
          href={(x) => `${base}?cliente=${x.slug}`}
        />
      )}
      {mostraProjeto && (
        <Fileira
          rotulo="Projeto"
          itens={projetos}
          atual={projetoAtual}
          href={(x) => `${base}?cliente=${clienteAtual}&projeto=${x.slug}`}
        />
      )}
    </div>
  )
}

function Fileira({
  rotulo,
  itens,
  atual,
  href,
}: {
  rotulo: string
  itens: Item[]
  atual: string | null
  href: (x: Item) => string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-tinta-3)]">
        {rotulo}
      </span>
      {itens.map((x) => (
        <Link
          key={x.id}
          href={href(x) as '/fluxos'}
          className={`rounded-lg border px-3 py-1.5 text-[13px] ${
            x.slug === atual ? 'border-[var(--color-acento)] text-[var(--color-acento)]' : ''
          }`}
        >
          {x.nome}
        </Link>
      ))}
    </div>
  )
}
