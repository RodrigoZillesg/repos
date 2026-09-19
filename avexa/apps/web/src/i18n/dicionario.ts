/** Dicionário PT/EN.
 *
 *  Sem biblioteca: o painel tem duas línguas e nenhuma pluralização complicada,
 *  e um dicionário tipado dá erro de compilação quando uma chave falta — que é
 *  exatamente a garantia que uma biblioteca de i18n não dá de graça. */

export const IDIOMAS = ['pt-BR', 'en'] as const
export type Idioma = (typeof IDIOMAS)[number]

const pt = {
  'app.nome': 'Avexa',
  'nav.ativar': 'Ativar cliente',
  'nav.fluxos': 'Fluxos',
  'nav.templates': 'Templates',
  'nav.arquitetura': 'Arquitetura',
  'nav.leads': 'Leads',
  'nav.sair': 'Sair',
  'comum.cliente': 'Cliente',
  'comum.fluxo': 'Fluxo',
  'comum.salvar': 'Salvar',
  'comum.cancelar': 'Cancelar',
  'comum.novo': 'Novo',
  'comum.renomear': 'Renomear',
  'comum.remover': 'Remover',
  'comum.fechar': 'Fechar',
  'comum.copiar': 'Copiar',
  'comum.copiado': 'URL copiada',
  'comum.publicar': 'Publicar',
  'comum.simular': 'Rodar simulação',
  'comum.nenhum': 'Nenhum',
  'entrar.titulo': 'Entrar no Avexa',
  'entrar.descricao':
    'Informe seu e-mail. Mandamos um link de acesso — sem senha para lembrar.',
  'entrar.email': 'E-mail',
  'entrar.acao': 'Mandar link de acesso',
  'entrar.enviado':
    'Se este e-mail tiver acesso, o link chega em instantes. Ele vale por 15 minutos.',
  'entrar.invalido': 'Link inválido ou expirado. Peça um novo.',
  'ativar.titulo': 'Colocar um cliente novo no ar',
  'ativar.descricao':
    'Tudo que a Avexa precisa para falar com os leads de um cliente é provisionado por este painel. O cliente não cria conta em lugar nenhum, não cadastra cartão e não mexe em DNS. Ele recebe uma URL de webhook, cola na saída do formulário dele, e pronto.',
  'ativar.sequencia': 'Sequência de ativação',
  'ativar.automatico': 'automático',
  'ativar.depende': 'depende do cliente',
  'ativar.acao': 'Ativar cliente',
  'fluxos.canais': 'Canais contratados',
  'fluxos.adicionar': 'Adicionar etapa',
  'fluxos.dica':
    'Clique no + da linha para inserir entre duas etapas. A lista acima acrescenta no fim do fluxo.',
  'fluxos.escolha': 'Escolha uma etapa no fluxo para configurar.',
  'fluxos.subir': 'Subir',
  'fluxos.descer': 'Descer',
  'fluxos.fixa': 'Esta etapa não pode ser removida. O motor a aplica mesmo que ela não apareça desenhada.',
  'fluxos.off': 'off',
  'templates.biblioteca': 'Biblioteca',
  'templates.verComo': 'Ver o painel como',
  'templates.aprovado': 'aprovado',
  'templates.pendente': 'pendente',
  'templates.rejeitado': 'rejeitado',
  'templates.rascunho': 'rascunho',
  'templates.submeter': 'Submeter à Meta',
  'templates.avisoTexto':
    'Trocar o valor de uma variável não exige nova aprovação; mudar o texto fixo, sim.',
  'sim.titulo': 'Simulação',
  'sim.lead': 'Lead',
  'sim.rodarDeNovo': 'Rodar de novo',
  'sim.contatos': 'contatos',
  'leads.titulo': 'Seus leads',
  'leads.vazio': 'Nenhum lead recebido ainda.',
  'leads.score': 'Score',
  'leads.resultado': 'Resultado',
  'leads.recebido': 'Recebido',
  'seco.aviso':
    'Modo seco: o fluxo roda inteiro e cada tentativa fica gravada, mas nada é enviado.',
} as const

export type Chave = keyof typeof pt

const en: Record<Chave, string> = {
  'app.nome': 'Avexa',
  'nav.ativar': 'Activate client',
  'nav.fluxos': 'Flows',
  'nav.templates': 'Templates',
  'nav.arquitetura': 'Architecture',
  'nav.leads': 'Leads',
  'nav.sair': 'Sign out',
  'comum.cliente': 'Client',
  'comum.fluxo': 'Flow',
  'comum.salvar': 'Save',
  'comum.cancelar': 'Cancel',
  'comum.novo': 'New',
  'comum.renomear': 'Rename',
  'comum.remover': 'Remove',
  'comum.fechar': 'Close',
  'comum.copiar': 'Copy',
  'comum.copiado': 'URL copied',
  'comum.publicar': 'Publish',
  'comum.simular': 'Run simulation',
  'comum.nenhum': 'None',
  'entrar.titulo': 'Sign in to Avexa',
  'entrar.descricao': 'Enter your email. We send a sign-in link — no password to remember.',
  'entrar.email': 'Email',
  'entrar.acao': 'Send sign-in link',
  'entrar.enviado': 'If this email has access, the link arrives shortly. It is valid for 15 minutes.',
  'entrar.invalido': 'Invalid or expired link. Request a new one.',
  'ativar.titulo': 'Put a new client live',
  'ativar.descricao':
    'Everything Avexa needs to reach a client’s leads is provisioned from this panel. The client creates no account, enters no card and touches no DNS. They get a webhook URL, paste it into their form’s output, and that is it.',
  'ativar.sequencia': 'Activation sequence',
  'ativar.automatico': 'automatic',
  'ativar.depende': 'client’s part',
  'ativar.acao': 'Activate client',
  'fluxos.canais': 'Contracted channels',
  'fluxos.adicionar': 'Add step',
  'fluxos.dica':
    'Use the + on a line to insert between two steps. The list above appends to the end of the flow.',
  'fluxos.escolha': 'Pick a step in the flow to configure it.',
  'fluxos.subir': 'Move up',
  'fluxos.descer': 'Move down',
  'fluxos.fixa': 'This step cannot be removed. The engine applies it even when it is not drawn.',
  'fluxos.off': 'off',
  'templates.biblioteca': 'Library',
  'templates.verComo': 'View the panel as',
  'templates.aprovado': 'approved',
  'templates.pendente': 'pending',
  'templates.rejeitado': 'rejected',
  'templates.rascunho': 'draft',
  'templates.submeter': 'Submit to Meta',
  'templates.avisoTexto':
    'Changing a variable’s value needs no new approval; changing the fixed text does.',
  'sim.titulo': 'Simulation',
  'sim.lead': 'Lead',
  'sim.rodarDeNovo': 'Run again',
  'sim.contatos': 'contacts',
  'leads.titulo': 'Your leads',
  'leads.vazio': 'No leads received yet.',
  'leads.score': 'Score',
  'leads.resultado': 'Outcome',
  'leads.recebido': 'Received',
  'seco.aviso': 'Dry run: the flow runs in full and every attempt is recorded, but nothing is sent.',
}

const DICIONARIOS = { 'pt-BR': pt, en } as const

export function traduzir(idioma: Idioma, chave: Chave): string {
  return DICIONARIOS[idioma][chave] ?? pt[chave]
}

export function criarT(idioma: Idioma) {
  return (chave: Chave) => traduzir(idioma, chave)
}

export type T = ReturnType<typeof criarT>

/** Dicionário inteiro, para passar a um componente de cliente de uma vez.
 *  São poucas dezenas de chaves; mandar tudo evita prop-drilling de função. */
export function dicionarioDe(idioma: Idioma): Record<Chave, string> {
  return DICIONARIOS[idioma] as Record<Chave, string>
}
