/** Números de telefone: ver, comprar e atribuir.
 *
 *  Comprar gasta dinheiro de verdade, todo mês, por número — por isso
 *  `procurar` existe separado de `comprar`: dá para olhar o que há antes de
 *  se comprometer.
 *
 *      pnpm --filter @avexa/worker numeros listar
 *      pnpm --filter @avexa/worker numeros procurar AU
 *      pnpm --filter @avexa/worker numeros comprar AU [slug-do-cliente]
 *      pnpm --filter @avexa/worker numeros webhooks
 */
import { eq } from 'drizzle-orm'
import { cliente, db, numero } from '@avexa/db'
import { buscarNumerosDisponiveis } from '@avexa/adapters'
import {
  credenciaisDoAmbiente,
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

if (comando === 'procurar') {
  const pais = (resto[0] ?? '').trim()
  if (!pais) {
    console.error('uso: numeros procurar <pais>   (AU, US, ...)')
    process.exit(1)
  }

  const r = await buscarNumerosDisponiveis(cred, { pais, exigeVoz: true, limite: 10 })
  if (!r.ok) {
    console.error(`falhou: ${r.erro}`)
    process.exit(1)
  }
  if (r.numeros.length === 0) {
    console.log(`nenhum número com voz e SMS disponível em ${pais.toUpperCase()}`)
    process.exit(0)
  }
  for (const n of r.numeros) {
    console.log(`${n.e164}  ${n.locality ?? n.regiao ?? ''}  ${n.capacidades.join('+')}`)
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

console.error('uso: numeros listar | procurar <pais> | comprar <pais> [slug] | webhooks')
process.exit(1)
