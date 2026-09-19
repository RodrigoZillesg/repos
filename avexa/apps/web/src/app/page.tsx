import { redirect } from 'next/navigation'
import { sessaoAtual } from '@/lib/auth'

export default async function Inicio() {
  const s = await sessaoAtual()
  if (!s) redirect('/entrar')
  // Cada papel cai na primeira tela que ele pode de fato usar: mandar um
  // designer para a lista de fluxos seria mandá-lo para uma tela vazia.
  if (s.permissoes.escopoCliente) redirect('/leads')
  if (!s.permissoes.verFluxos) redirect('/templates')
  redirect('/fluxos')
}
