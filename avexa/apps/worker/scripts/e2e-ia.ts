/** Faz o modelo qualificar um lead de mentira e mostra o que ele devolveu.
 *
 *  Chave presente não é modelo funcionando: cota estourada, chave sem
 *  permissão e nome de modelo errado passam por qualquer checagem e só
 *  aparecem numa chamada de verdade. E o `qualificar` foi feito para nunca
 *  derrubar o lead quando o modelo falha — ele devolve o resultado de
 *  segurança com `confiavel: false`. Isso é certo em produção e péssimo para
 *  diagnóstico, porque a falha fica silenciosa. Aqui ela é o ponto.
 *
 *      pnpm --filter @avexa/worker e2e:ia
 */
import { modeloDoAmbiente, qualificar } from '@avexa/ia'

const modelo = modeloDoAmbiente()
if (!modelo) {
  console.error('nenhum modelo configurado: falta GEMINI_API_KEY (ou IA_PROVEDOR não é gemini)')
  process.exit(1)
}

console.log(`modelo: ${process.env.IA_MODELO ?? '(padrão do adaptador)'}`)

// Dois leads opostos de propósito: se os dois receberem a mesma nota, o
// modelo respondeu mas não está discriminando, e isso também é uma falha.
const CASOS = [
  {
    nome: 'lead bom',
    historico:
      'Perguntou o preço do curso intensivo de inglês, disse que quer começar em fevereiro ' +
      'e pediu para receber a proposta por e-mail. Confirmou que mora em Sydney.',
  },
  {
    nome: 'lead ruim',
    historico: 'Não respondeu nenhuma mensagem. Nenhum contato recebido.',
  },
]

let falhou = false

for (const caso of CASOS) {
  const r = await qualificar(modelo, {
    contexto: 'escola de inglês na Austrália, vende cursos presenciais para estrangeiros',
    criterios: 'tem interesse declarado, tem prazo definido e está na região atendida',
    historico: caso.historico,
  })

  console.log(`\n== ${caso.nome} ==`)
  console.log(`score: ${r.score ?? '(nulo)'}`)
  console.log(`motivo: ${r.motivo}`)
  console.log(`resumo: ${r.resumo}`)

  if (!r.confiavel) {
    console.error(`FALHOU: o modelo não respondeu de forma utilizável — ${r.motivo}`)
    falhou = true
  }
}

if (falhou) process.exit(1)

console.log('\no modelo respondeu nos dois casos; confira se as notas fazem sentido acima')
process.exit(0)
