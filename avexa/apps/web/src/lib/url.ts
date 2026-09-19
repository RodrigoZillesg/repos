/** A base pública do painel.
 *
 *  `new URL(req.url).origin` NÃO serve para isto, e essa é a armadilha que
 *  custou o primeiro login em produção. O Next em modo standalone monta a URL
 *  da requisição a partir de onde o processo escuta — `HOSTNAME=0.0.0.0`,
 *  `PORT=3000` —, não do `Host` que o nginx repassa. Todo redirecionamento
 *  absoluto construído assim manda o navegador para `https://0.0.0.0:3000`,
 *  que não existe em lugar nenhum.
 *
 *  A ordem é deliberada. `DOMINIO` é a identidade canônica do ambiente e não
 *  depende de cabeçalho nenhum: quem chega por um `Host` forjado não consegue
 *  mudar para onde o painel redireciona, nem para onde um retorno de OAuth
 *  aponta. Os cabeçalhos do proxy só entram quando `DOMINIO` não existe, que é
 *  o caso do desenvolvimento. */
export function basePublica(cabecalhos: Headers, urlDaRequisicao?: string): string {
  const dominio = process.env.DOMINIO?.trim()
  if (dominio) return `https://${semBarraFinal(dominio)}`

  // `x-forwarded-host` primeiro: quando há mais de um proxy no caminho, é ele
  // que carrega o host que o navegador realmente pediu.
  const host = primeiroValor(cabecalhos.get('x-forwarded-host')) ?? cabecalhos.get('host')
  if (host) {
    const proto = primeiroValor(cabecalhos.get('x-forwarded-proto')) ?? 'http'
    return `${proto}://${host}`
  }

  // Sem proxy e sem domínio: é o `next dev` na máquina de alguém.
  return urlDaRequisicao ? new URL(urlDaRequisicao).origin : 'http://localhost:3000'
}

/** Um cabeçalho encadeado por vários proxies vem como "a, b". O primeiro é o
 *  que o cliente pediu; os seguintes são os saltos internos. */
const primeiroValor = (v: string | null) => v?.split(',')[0]?.trim() || null

const semBarraFinal = (v: string) => v.replace(/\/+$/, '')
