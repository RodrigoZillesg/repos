import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Cifragem em repouso dos segredos de integração.
 *
 *  Um refresh token do Google Workspace não expira sozinho e dá acesso contínuo
 *  à agenda e às planilhas do cliente. Em texto puro no banco, um dump vira
 *  acesso permanente a dados de terceiros — por isso ele nunca é gravado como
 *  veio.
 *
 *  AES-256-GCM: a autenticação embutida faz um texto cifrado adulterado falhar
 *  em vez de decifrar em lixo. O `aad` amarra o segredo ao dono; um texto
 *  cifrado movido de um cliente para outro no banco não decifra. */

const ALGORITMO = 'aes-256-gcm'
const VERSAO = 'v1'

function chave(): Buffer {
  const bruta = process.env.APP_SECRET
  if (!bruta || bruta.length < 32) {
    throw new Error(
      'APP_SECRET ausente ou curta demais (mínimo 32 caracteres). Sem ela não há como cifrar segredos de integração.',
    )
  }
  // Deriva 32 bytes da variável de ambiente, que pode ter qualquer tamanho.
  return createHash('sha256').update(bruta).digest()
}

/** Cifra um segredo. `aad` é o contexto a que ele pertence — normalmente o id do
 *  cliente e o tipo da integração. */
export function cifrar(claro: string, aad: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv(ALGORITMO, chave(), iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const dados = Buffer.concat([c.update(claro, 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return [VERSAO, iv.toString('base64url'), tag.toString('base64url'), dados.toString('base64url')].join('.')
}

/** Decifra. Devolve `null` quando o texto foi adulterado, a chave mudou ou o
 *  contexto não bate — nunca lança, para que uma integração quebrada não derrube
 *  o fluxo inteiro de um lead. */
export function decifrar(cifrado: string | null | undefined, aad: string): string | null {
  if (!cifrado) return null
  const partes = cifrado.split('.')
  if (partes.length !== 4 || partes[0] !== VERSAO) return null

  try {
    const d = createDecipheriv(ALGORITMO, chave(), Buffer.from(partes[1]!, 'base64url'))
    d.setAAD(Buffer.from(aad, 'utf8'))
    d.setAuthTag(Buffer.from(partes[2]!, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(partes[3]!, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Assina um valor curto, para o `state` do OAuth. */
export function assinar(valor: string): string {
  const mac = createHash('sha256').update(`${chave().toString('base64')}:${valor}`).digest('base64url')
  return `${Buffer.from(valor, 'utf8').toString('base64url')}.${mac}`
}

/** Confere e devolve o valor assinado, ou `null`. Comparação em tempo constante. */
export function conferirAssinatura(assinado: string | null | undefined): string | null {
  if (!assinado) return null
  const [corpo, mac] = assinado.split('.')
  if (!corpo || !mac) return null

  const valor = Buffer.from(corpo, 'base64url').toString('utf8')
  const esperado = createHash('sha256').update(`${chave().toString('base64')}:${valor}`).digest('base64url')

  const a = Buffer.from(mac)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return null
  return timingSafeEqual(a, b) ? valor : null
}
