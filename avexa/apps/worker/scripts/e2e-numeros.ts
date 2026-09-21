/** Inventário de números ponta a ponta, contra o banco de verdade.
 *
 *  O Twilio é substituído por um `buscar` injetado — a mesma porta que os
 *  adaptadores já abrem para teste. Isso cobre o que os testes de unidade não
 *  cobrem: a paginação do Twilio, a consulta com os dois left joins, e o
 *  cruzamento das duas listas com dados reais do banco.
 *
 *  A paginação é o motivo principal. O Twilio devolve 50 por página e um
 *  `next_page_uri`; parar na primeira daria uma lista que parece completa e não
 *  é, e o sintoma seria comprar de novo um número que já se tem.
 *
 *      pnpm --filter @avexa/worker e2e:numeros
 */
import { eq } from 'drizzle-orm'
import { cliente, db, numero, projeto } from '@avexa/db'
import { inventarioDeNumeros } from '@avexa/servicos'

const d = db()

const NOSSO = '+61255500101' // do seed, atribuído ao ihte
const DE_FORA = '+13309197898' // existe só no Twilio, como os da operação antiga
const SUMIDO = '+61255500102' // no seed e, como todos eles, ausente do Twilio

const daConta = (e164: string, nome: string) => ({
  sid: `PN${e164.replace(/\D/g, '')}`,
  phone_number: e164,
  friendly_name: nome,
  capabilities: { voice: true, SMS: true },
  sms_url: 'https://new.avexa.global/api/webhooks/sms',
  voice_url: null,
})

// Duas páginas de propósito: uma implementação que ignora next_page_uri passa
// no teste de uma página só e perde metade da conta na primeira conta grande.
let paginasPedidas = 0
const buscar: typeof fetch = async (url) => {
  paginasPedidas++
  const primeira = !String(url).includes('Page=2')
  const corpo = primeira
    ? {
        incoming_phone_numbers: [daConta(NOSSO, 'nome velho que ninguém trocou')],
        next_page_uri: '/2010-04-01/Accounts/AC_teste/IncomingPhoneNumbers.json?Page=2',
      }
    : { incoming_phone_numbers: [daConta(DE_FORA, 'Alice AI EN TALOGY - Path B')], next_page_uri: null }
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// Dá um projeto ao cliente do número, para o apelido sugerido ter as duas partes.
const [ihte] = await d.select().from(cliente).where(eq(cliente.slug, 'ihte')).limit(1)
if (!ihte) {
  console.error('sem o cliente ihte: rode o seed antes')
  process.exit(1)
}
const [p] =
  (await d.select().from(projeto).where(eq(projeto.clienteId, ihte.id)).limit(1)).length > 0
    ? await d.select().from(projeto).where(eq(projeto.clienteId, ihte.id)).limit(1)
    : await d
        .insert(projeto)
        .values({ clienteId: ihte.id, nome: 'Sydney CBD', slug: 'sydney-cbd' })
        .returning()
await d.update(numero).set({ projetoId: p!.id }).where(eq(numero.e164, NOSSO))

const r = await inventarioDeNumeros(d, {
  accountSid: 'AC_teste',
  authToken: 'token',
  buscar,
})

if (!r.ok) {
  console.error('falhou:', r.erro)
  process.exit(1)
}

let erros = 0
const conferir = (o: string, esperado: unknown, obtido: unknown) => {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido)
  console.log(`${ok ? '  ok  ' : 'FALHOU'} ${o}${ok ? '' : `\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`)
  if (!ok) erros++
}

const acharNum = (e164: string) => r.numeros.find((n) => n.e164 === e164)

conferir('seguiu a paginação até o fim', 2, paginasPedidas)
conferir('o número de fora veio da segunda página', 'fora', acharNum(DE_FORA)?.origem)
conferir('o nome do número de fora é o do Twilio', 'Alice AI EN TALOGY - Path B', acharNum(DE_FORA)?.apelido)
conferir('o nosso número foi reconhecido', 'avexa', acharNum(NOSSO)?.origem)
conferir('o nosso número traz o cliente', ihte.nome, acharNum(NOSSO)?.clienteNome)
conferir('o nosso número traz o projeto', p!.nome, acharNum(NOSSO)?.projetoNome)
conferir(
  'o apelido sugerido junta cliente e projeto',
  `${ihte.nome} · ${p!.nome}`,
  acharNum(NOSSO)?.apelidoSugerido,
)
conferir('o nome velho é marcado fora do padrão', true, acharNum(NOSSO)?.foraDoPadrao)
conferir('o número do seed que não está no Twilio aparece como sumido', 'sumido', acharNum(SUMIDO)?.origem)
conferir('o sumido não tem SID', null, acharNum(SUMIDO)?.sid)
conferir('os sumidos vêm primeiro', 'sumido', r.numeros[0]?.origem)
conferir('nenhum número aparece duas vezes', r.numeros.length, new Set(r.numeros.map((n) => n.e164)).size)

console.log(`\n${erros === 0 ? 'tudo certo' : `${erros} conferência(s) falharam`}`)
process.exit(erros === 0 ? 0 : 1)
