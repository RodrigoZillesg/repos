/** Reconhecimento de pedido de parada em mensagem recebida.
 *
 *  Um opt-out não reconhecido é a pior falha do produto: a pessoa pediu para
 *  parar, o sistema não entendeu, e continua contatando. Por isso a leitura é
 *  generosa — reconhece as palavras isoladas e também frases curtas que as
 *  contenham — e conservadora ao mesmo tempo: na dúvida entre suprimir e não
 *  suprimir, suprime. Suprimir alguém que não pediu custa um lead; não suprimir
 *  quem pediu custa uma reclamação e, dependendo do país, uma multa. */

/** Palavras que, sozinhas, são pedido de parada. É o conjunto que as operadoras
 *  exigem reconhecer em SMS, mais os equivalentes em português. */
const PALAVRAS_PARADA = [
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'optout',
  'opt-out',
  'remove',
  'parar',
  'pare',
  'sair',
  'cancelar',
  'descadastrar',
  'remover',
]

/** Frases curtas que também contam, mesmo com outras palavras em volta. */
const FRASES_PARADA = [
  'não quero mais',
  'nao quero mais',
  'não me ligue',
  'nao me ligue',
  'não me liguem',
  'nao me liguem',
  'não entre em contato',
  'nao entre em contato',
  'me tira da lista',
  'me tire da lista',
  'tira meu numero',
  'tire meu número',
  'stop messaging',
  'stop contacting',
  'do not contact',
  "don't contact",
  'take me off',
  'remove me',
  'leave me alone',
]

/** Palavras que, sozinhas, retomam o contato depois de um opt-out por SMS. */
const PALAVRAS_RETOMADA = ['start', 'unstop', 'yes', 'voltar', 'retomar']

function limpar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const semAcento = (s: string) => limpar(s)

/** O texto recebido é um pedido para parar de receber contato? */
export function ehPedidoDeParada(texto: string | null | undefined): boolean {
  if (!texto) return false
  const limpo = limpar(texto)
  if (!limpo) return false

  const palavras = limpo.split(' ')

  // Mensagem curta formada só por palavras de parada: o caso clássico do SMS.
  if (palavras.length <= 3 && palavras.some((p) => PALAVRAS_PARADA.includes(p))) return true

  for (const frase of FRASES_PARADA) {
    if (limpo.includes(semAcento(frase))) return true
  }
  return false
}

/** O texto é um pedido de retomada? Só vale como palavra isolada: "yes, tell me
 *  more" não pode desfazer um opt-out. */
export function ehPedidoDeRetomada(texto: string | null | undefined): boolean {
  if (!texto) return false
  const limpo = limpar(texto)
  return PALAVRAS_RETOMADA.includes(limpo)
}
