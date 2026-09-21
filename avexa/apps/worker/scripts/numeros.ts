/** Números de telefone: ver, comprar e atribuir.
 *
 *  Comprar gasta dinheiro de verdade, todo mês, por número — por isso
 *  `procurar` existe separado de `comprar`: dá para olhar o que há antes de
 *  se comprometer.
 *
 *      pnpm --filter @avexa/worker numeros listar
 *      pnpm --filter @avexa/worker numeros reais
 *      pnpm --filter @avexa/worker numeros procurar AU
 *      pnpm --filter @avexa/worker numeros comprar AU [slug-do-cliente]
 *      pnpm --filter @avexa/worker numeros webhooks
 */
import { eq } from 'drizzle-orm'
import { cliente, db, numero } from '@avexa/db'
import { buscarNumerosDisponiveis, type TipoDeNumero } from '@avexa/adapters'
import {
  credenciaisDoAmbiente,
  inventarioDeNumeros,
  provisionarNumero,
  reapontarWebhooks,
  webhookDeSms,
} from '@avexa/servicos'

const [comando, ...resto] = process.argv.slice(2)
const d = db()

if (comando === 'listar') {
  const todos = await d.select().from(numero)
  if (todos.length === 0) {
    console.log('nenhum número cadastrado')
    process.exit(0)
  }
  for (const n of todos) {
    const dono = n.clienteId ? `cliente ${n.clienteId.slice(0, 8)}` : 'livre'
    console.log(
      `${n.e164}  ${n.status.padEnd(9)} ${dono.padEnd(20)} ${n.capacidades.join('+')}` +
        `${n.provedorSid ? '' : '  (sem SID: comprado fora da plataforma)'}`,
    )
  }
  process.exit(0)
}

const cred = credenciaisDoAmbiente()
if (!cred) {
  console.error('faltam TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN no ambiente')
  process.exit(1)
}

/** O que a conta do Twilio tem de verdade, ao lado do que a Avexa acha que tem.
 *
 *  `listar` mostra a nossa tabela; este mostra a conta. Os dois divergem, e a
 *  divergência é o que interessa: número que existe lá e não aqui é da operação
 *  antiga, e número que existe aqui e não lá não manda nada. */
if (comando === 'reais') {
  const r = await inventarioDeNumeros(d, cred)
  if (!r.ok) {
    console.error(`não deu para ler a conta do Twilio: ${r.erro}`)
    process.exit(1)
  }

  const rotulo = { avexa: 'avexa ', fora: 'FORA  ', sumido: 'SUMIDO' } as const
  for (const n of r.numeros) {
    const dono = n.clienteNome
      ? `${n.clienteNome}${n.projetoNome ? ` · ${n.projetoNome}` : ''}`
      : ''
    console.log(`${rotulo[n.origem]} ${n.e164.padEnd(15)} ${n.apelido || '(sem nome)'}`)
    if (dono) console.log(`       ${' '.repeat(15)} na Avexa: ${dono}`)
    if (n.foraDoPadrao && n.apelidoSugerido) {
      console.log(`       ${' '.repeat(15)} sugerido: ${n.apelidoSugerido}`)
    }
    if (n.origem === 'sumido') {
      console.log(`       ${' '.repeat(15)} NÃO EXISTE no Twilio — nada sai por ele`)
    }
  }

  const sumidos = r.numeros.filter((n) => n.origem === 'sumido').length
  console.log(
    `\n${r.numeros.length} número(s): ` +
      `${r.numeros.filter((n) => n.origem === 'avexa').length} da Avexa, ` +
      `${r.numeros.filter((n) => n.origem === 'fora').length} de fora, ` +
      `${sumidos} sumido(s).`,
  )
  process.exit(sumidos > 0 ? 1 : 0)
}

if (comando === 'procurar') {
  const pais = (resto[0] ?? '').trim()
  if (!pais) {
    console.error('uso: numeros procurar <pais>   (AU, US, ...)')
    process.exit(1)
  }

  // Procura nos três tipos. Na Austrália, número Local em geral não manda
  // SMS — quem manda é Mobile —, e procurar só em Local devolve lista vazia
  // que parece "não há número no país" em vez de "procurei no lugar errado".
  const TIPOS: TipoDeNumero[] = ['Local', 'Mobile', 'TollFree']
  let achou = 0

  for (const tipo of TIPOS) {
    const r = await buscarNumerosDisponiveis(cred, { pais, tipo, exigeVoz: true, limite: 5 })
    if (!r.ok) {
      console.log(`${tipo.padEnd(8)} erro: ${r.erro}`)
      continue
    }
    if (r.numeros.length === 0) {
      console.log(`${tipo.padEnd(8)} nenhum com voz + SMS`)
      continue
    }
    console.log(`${tipo}:`)
    for (const n of r.numeros) {
      console.log(`  ${n.e164}  ${n.locality ?? n.regiao ?? ''}  ${n.capacidades.join('+')}`)
      achou++
    }
  }

  if (achou === 0) {
    console.log(
      `\nnada com voz + SMS em ${pais.toUpperCase()}. As causas comuns são, nesta ordem:\n` +
        '  1. falta o cadastro regulatório (Regulatory Bundle) do país na conta Twilio;\n' +
        '  2. falta endereço verificado (Address) exigido pelo país;\n' +
        '  3. a conta ainda é trial, e trial não compra número.\n' +
        'O console do Twilio em Phone Numbers > Regulatory Compliance diz qual é o caso.',
    )
    process.exit(0)
  }

  console.log('\nnada foi comprado. use `numeros comprar` para adquirir um.')
  process.exit(0)
}

if (comando === 'comprar') {
  const pais = (resto[0] ?? '').trim()
  const slug = (resto[1] ?? '').trim()
  if (!pais) {
    console.error('uso: numeros comprar <pais> [slug-do-cliente]')
    process.exit(1)
  }

  let clienteId: string | undefined
  let apelido = 'Avexa'
  if (slug) {
    const [c] = await d.select().from(cliente).where(eq(cliente.slug, slug)).limit(1)
    if (!c) {
      // Comprar e só depois descobrir que o cliente não existe deixaria um
      // número pago sem dono. Falha antes de gastar.
      console.error(`nenhum cliente com o slug ${slug}`)
      process.exit(1)
    }
    clienteId = c.id
    apelido = `Avexa · ${c.nome}`
  }

  const webhook = webhookDeSms()
  if (!webhook) {
    console.error('DOMINIO não está no ambiente: o número ficaria sem webhook e perderia opt-out')
    process.exit(1)
  }

  console.log(`comprando um número em ${pais.toUpperCase()}${slug ? ` para ${slug}` : ' (pool)'}`)
  console.log(`webhook: ${webhook}`)

  const r = await provisionarNumero(
    d,
    cred,
    { pais, ...(clienteId ? { clienteId } : {}), apelido },
    webhook,
  )
  if (!r.ok) {
    console.error(`falhou: ${r.erro}`)
    process.exit(1)
  }

  console.log(`comprado: ${r.e164} (${r.sid})`)
  console.log(r.atribuido ? 'atribuído ao cliente e definido como remetente' : 'no pool, livre')
  process.exit(0)
}

if (comando === 'webhooks') {
  const webhook = webhookDeSms()
  if (!webhook) {
    console.error('DOMINIO não está no ambiente')
    process.exit(1)
  }
  console.log(`reapontando todos os números para ${webhook}`)

  const saida = await reapontarWebhooks(d, cred, webhook)
  if (saida.length === 0) console.log('nenhum número do Twilio cadastrado')
  for (const s of saida) console.log(`${s.ok ? '  ok  ' : 'falhou'} ${s.e164}${s.erro ? ` — ${s.erro}` : ''}`)
  process.exit(saida.some((s) => !s.ok) ? 1 : 0)
}

console.error('uso: numeros listar | reais | procurar <pais> | comprar <pais> [slug] | webhooks')
process.exit(1)
