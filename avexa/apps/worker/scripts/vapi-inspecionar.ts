/** Olha o que já existe na conta Vapi. Só leitura — não cria nem altera nada.
 *
 *  Existe para uma coisa: entender a forma real de um agente antes de modelar
 *  o nosso. Hoje já apanhamos duas vezes por supor forma de fornecedor — o
 *  modelo do Gemini que estava aposentado e o phoneNumberId da Vapi que eu
 *  presumi ser E.164. Aqui a fonte é a conta, não a memória.
 *
 *      pnpm --filter @avexa/worker vapi                 # resumo
 *      pnpm --filter @avexa/worker vapi <id-do-agente>  # um agente inteiro
 */
import { requisitar } from '@avexa/adapters'

const chave = process.env.VAPI_API_KEY
if (!chave) {
  console.error('VAPI_API_KEY não está no ambiente')
  process.exit(1)
}

const cabecalhos = { authorization: `Bearer ${chave}` }
const pegar = (caminho: string) =>
  requisitar(`https://api.vapi.ai${caminho}`, { metodo: 'GET', cabecalhos })

const alvo = (process.argv[2] ?? '').trim()

if (alvo) {
  const r = await pegar(`/assistant/${alvo}`)
  if (!r.ok) {
    console.error(`falhou: ${r.erro}`)
    process.exit(1)
  }
  // O objeto inteiro, sem filtro: é justamente o que não se sabe de antemão
  // que interessa aqui.
  console.log(JSON.stringify(r.corpo, null, 2))
  process.exit(0)
}

const [assistentes, numeros] = await Promise.all([pegar('/assistant'), pegar('/phone-number')])

if (!assistentes.ok) {
  console.error(`falhou ao listar assistentes: ${assistentes.erro}`)
  process.exit(1)
}

const lista = Array.isArray(assistentes.corpo) ? assistentes.corpo : []
console.log(`== assistentes (${lista.length}) ==`)
for (const a of lista) {
  const x = a as Record<string, unknown>
  const modelo = (x.model ?? {}) as Record<string, unknown>
  const voz = (x.voice ?? {}) as Record<string, unknown>
  console.log(
    `${String(x.id)}  ${String(x.name ?? '(sem nome)')}\n` +
      `   modelo: ${String(modelo.provider ?? '?')}/${String(modelo.model ?? '?')}` +
      `   voz: ${String(voz.provider ?? '?')}/${String(voz.voiceId ?? '?')}` +
      `   transcritor: ${String(((x.transcriber ?? {}) as Record<string, unknown>).provider ?? '?')}`,
  )
}

console.log(`\n== números na Vapi ==`)
if (!numeros.ok) {
  console.log(`falhou ao listar: ${numeros.erro}`)
} else {
  const ns = Array.isArray(numeros.corpo) ? numeros.corpo : []
  if (ns.length === 0) console.log('nenhum')
  for (const n of ns) {
    const x = n as Record<string, unknown>
    // O id da Vapi é o que o motor precisa para ligar: o E.164 sozinho não
    // serve, e essa confusão já custou uma rodada.
    console.log(
      `${String(x.id)}  ${String(x.number ?? '?')}  provedor: ${String(x.provider ?? '?')}` +
        `  assistente: ${String(x.assistantId ?? '(nenhum)')}`,
    )
  }
}

if (lista.length > 0) {
  console.log(
    `\npara ver um agente inteiro:\n` +
      `  pnpm --filter @avexa/worker vapi ${String((lista[0] as Record<string, unknown>).id)}`,
  )
}
process.exit(0)
