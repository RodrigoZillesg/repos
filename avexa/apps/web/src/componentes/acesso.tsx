'use client'

import { useState, useTransition } from 'react'
import { Copy, Send, TriangleAlert, UserPlus } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Rotulo, Selecao } from '@/componentes/ui/campo'
import { Cartao, Selo } from '@/componentes/ui/cartao'
import type {
  FormConvite,
  ResultadoAcesso,
} from '@/app/(painel)/configuracoes/acoes'

export interface UsuarioNaLista {
  id: string
  nome: string
  email: string
  papel: string
  /** Nome do cliente, quando o papel é `cliente`. */
  cliente: string | null
  ativo: boolean
  ultimoAcessoEm: Date | null
  /** Quem está olhando a tela agora — não pode desativar a si mesmo. */
  souEu: boolean
}

interface Props {
  usuarios: UsuarioNaLista[]
  clientes: Array<{ id: string; nome: string }>
  papeis: Array<{ valor: string; rotulo: string; descricao: string }>
  podeAdministrar: boolean
  aoConvidar: (f: FormConvite) => Promise<ResultadoAcesso>
  aoReenviar: (usuarioId: string) => Promise<ResultadoAcesso>
  aoAlternar: (usuarioId: string, ativo: boolean) => Promise<ResultadoAcesso>
}

/** Quem entra no painel.
 *
 *  A parte que mais importa desta tela é o papel `cliente`: é como o cliente
 *  final passa a ver os próprios leads sem ver os de mais ninguém. Por isso o
 *  campo de cliente aparece grudado no papel, e não numa seção separada —
 *  escolher um sem o outro é a única forma de errar aqui. */
export function Acesso({
  usuarios,
  clientes,
  papeis,
  podeAdministrar,
  aoConvidar,
  aoReenviar,
  aoAlternar,
}: Props) {
  const [f, setF] = useState<FormConvite>({
    email: '',
    nome: '',
    papel: 'cliente',
    clienteId: clientes[0]?.id ?? '',
  })
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [rodando, iniciar] = useTransition()
  const travado = !podeAdministrar || rodando

  const campo = <K extends keyof FormConvite>(k: K, v: FormConvite[K]) =>
    setF((x) => ({ ...x, [k]: v }))

  const mostrar = (r: ResultadoAcesso, sucesso: string) => {
    setLink(r.link ?? null)
    setMsg(
      !r.ok
        ? { tom: 'erro', texto: r.erro ?? 'não deu certo' }
        : r.aviso
          ? { tom: 'aviso', texto: r.aviso }
          : { tom: 'ok', texto: sucesso },
    )
  }

  const descricaoDoPapel = papeis.find((p) => p.valor === f.papel)?.descricao ?? ''
  const semCliente = f.papel === 'cliente' && clientes.length === 0

  return (
    <div className="grid gap-4">
      <Cartao>
        <div className="flex flex-wrap items-center gap-2">
          <UserPlus size={15} />
          <h3 className="text-sm font-semibold">Dar acesso a alguém</h3>
        </div>
        <Ajuda>
          Não existe senha. A pessoa recebe um link por e-mail, entra, e a sessão dura 30 dias.
          Convidar alguém como <strong>cliente</strong> é o que abre o painel de leads para o
          cliente final.
        </Ajuda>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Rotulo htmlFor="ac-nome">Nome</Rotulo>
            <Entrada
              id="ac-nome"
              value={f.nome}
              disabled={travado}
              placeholder="Ana Ferreira"
              onChange={(e) => campo('nome', e.target.value)}
            />
          </div>
          <div>
            <Rotulo htmlFor="ac-email">E-mail</Rotulo>
            <Entrada
              id="ac-email"
              type="email"
              value={f.email}
              disabled={travado}
              placeholder="ana@cliente.com"
              onChange={(e) => campo('email', e.target.value)}
            />
            <Ajuda>É para cá que o link vai, e é por ele que a pessoa é identificada.</Ajuda>
          </div>
          <div>
            <Rotulo htmlFor="ac-papel">Papel</Rotulo>
            <Selecao
              id="ac-papel"
              value={f.papel}
              disabled={travado}
              onChange={(e) => campo('papel', e.target.value as FormConvite['papel'])}
            >
              {papeis.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </Selecao>
            <Ajuda>{descricaoDoPapel}</Ajuda>
          </div>

          {/* Só para o papel cliente, e obrigatório nele: é este campo que
              decide quais leads a pessoa enxerga. Um cliente sem vínculo entra
              e encontra uma tela vazia, sem erro que explique por quê. */}
          {f.papel === 'cliente' && (
            <div>
              <Rotulo htmlFor="ac-cliente">De qual cliente</Rotulo>
              <Selecao
                id="ac-cliente"
                value={f.clienteId}
                disabled={travado || clientes.length === 0}
                onChange={(e) => campo('clienteId', e.target.value)}
              >
                {clientes.length === 0 && <option value="">— nenhum cliente cadastrado —</option>}
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Selecao>
              <Ajuda>Ela verá os leads deste cliente e de nenhum outro.</Ajuda>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Botao
            disabled={travado || !f.email.trim() || !f.nome.trim() || semCliente}
            onClick={() =>
              iniciar(async () => {
                const r = await aoConvidar(f)
                mostrar(r, `Convite enviado para ${f.email.trim()}.`)
                if (r.ok) setF((x) => ({ ...x, email: '', nome: '' }))
              })
            }
          >
            <Send className="h-3.5 w-3.5" />
            Convidar
          </Botao>
        </div>
      </Cartao>

      {msg && (
        <div
          className={`rounded-lg border px-3 py-2 text-[13px] ${
            msg.tom === 'erro'
              ? 'border-[var(--color-perigo)] text-[var(--color-perigo)]'
              : msg.tom === 'aviso'
                ? 'border-[var(--color-alerta)]'
                : ''
          }`}
        >
          <span className="flex items-start gap-2">
            {msg.tom !== 'ok' && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{msg.texto}</span>
          </span>

          {/* O link de reserva, quando o e-mail não saiu. Não fica guardado em
              lugar nenhum: some ao recarregar, porque vale 15 minutos e
              funciona uma vez só. */}
          {link && (
            <span className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-fundo)] px-2 py-1 font-mono text-[11px]">
                {link}
              </code>
              <Botao
                variante="contorno"
                tamanho="pequeno"
                onClick={() => void navigator.clipboard?.writeText(link)}
              >
                <Copy className="h-3 w-3" />
                Copiar
              </Botao>
            </span>
          )}
        </div>
      )}

      <Cartao>
        <h3 className="text-sm font-semibold">Quem tem acesso</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-[var(--color-tinta-3)]">
              <tr>
                <th className="pb-2 font-medium">Pessoa</th>
                <th className="pb-2 font-medium">Papel</th>
                <th className="pb-2 font-medium">Último acesso</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {usuarios.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-medium">
                      {u.nome}
                      {u.souEu && <span className="text-[var(--color-tinta-3)]"> · você</span>}
                    </span>
                    <span className="block text-xs text-[var(--color-tinta-3)]">{u.email}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap items-center gap-1">
                      {u.ativo ? <Selo>{u.papel}</Selo> : <Selo tom="alerta">desativado</Selo>}
                      {u.cliente && <Selo tom="acento">{u.cliente}</Selo>}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-[var(--color-tinta-3)]">
                    {/* "Nunca entrou" é o sinal de convite que não chegou, e é
                        a pergunta que alguém faz uma semana depois. */}
                    {u.ultimoAcessoEm
                      ? u.ultimoAcessoEm.toISOString().slice(0, 10)
                      : 'nunca entrou'}
                  </td>
                  <td className="py-2">
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {u.ativo && (
                        <Botao
                          variante="contorno"
                          tamanho="pequeno"
                          disabled={travado}
                          onClick={() =>
                            iniciar(async () =>
                              mostrar(await aoReenviar(u.id), `Link novo enviado para ${u.email}.`),
                            )
                          }
                        >
                          Reenviar link
                        </Botao>
                      )}
                      {!u.souEu && (
                        <Botao
                          variante={u.ativo ? 'perigo' : 'contorno'}
                          tamanho="pequeno"
                          disabled={travado}
                          onClick={() =>
                            iniciar(async () =>
                              mostrar(
                                await aoAlternar(u.id, !u.ativo),
                                u.ativo ? `${u.nome} não entra mais.` : `${u.nome} voltou.`,
                              ),
                            )
                          }
                        >
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </Botao>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Ajuda>
          Desativar não apaga: o histórico de quem fez o quê continua ligado à pessoa, e o link de
          acesso para de funcionar na hora.
        </Ajuda>
      </Cartao>

      {!podeAdministrar && (
        <p className="text-xs text-[var(--color-tinta-3)]">
          Você pode ver quem tem acesso, mas só quem administra convida e desativa.
        </p>
      )}
    </div>
  )
}
