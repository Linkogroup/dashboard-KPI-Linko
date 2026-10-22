# KPI F4A — Linko Group | Regional Sul

## Estado atual

O repositório contém uma página estática (`index.html`) e uma regra da Vercel que encaminha as rotas para essa página. Não foram encontrados aplicação de servidor, API, banco de dados, mecanismo de autenticação, pipeline de deploy ou testes automatizados.

O painel foi mantido sem dados operacionais até que fontes reais e controles de acesso estejam disponíveis. Números, metas, parceiros, equipes, SLAs e gráficos anteriormente embutidos na página não eram provenientes de uma integração verificável e foram removidos. A página não autentica usuários nem deve receber dados reais.

## Navegação para a experiência operacional

A Vercel hospeda somente uma página estática de entrada. Ela oferece um link explícito para [`/dashboard-kpi` no Worker](https://f4a-paineis.michael-r-alves82.workers.dev/dashboard-kpi); não redireciona automaticamente, não faz requisições cross-origin e não lê, armazena ou reutiliza cookies ou tokens. O login e a autorização acontecem no Worker, e a experiência operacional permanece hospedada lá, sujeita ao acesso permitido para a conta.

A rota `/dashboard-kpi` ainda depende de uma PR separada no repositório do Worker. A publicação desta página não publica nem habilita a rota. O deploy operacional deve ser coordenado: primeiro implantar e validar a rota autenticada no Worker; depois confirmar que a rota está disponível para usuários autorizados antes de publicar ou divulgar esta página de entrada. Até lá, a página informa que o destino pode não estar disponível e não apresenta dados.

## Fonte candidata identificada

O Worker Cloudflare [`Linkogroup/f4a-paineis`](https://github.com/Linkogroup/f4a-paineis) é a fonte candidata. A rota de referência para endereços é [`/enderecos`](https://f4a-paineis.michael-r-alves82.workers.dev/enderecos); a rota-alvo autenticada deste dashboard é [`/dashboard-kpi`](https://f4a-paineis.michael-r-alves82.workers.dev/dashboard-kpi), a ser entregue em PR separada. O repositório contém código para D1 e rotas autenticadas de endereços (`/api/enderecos`) e produção (`/api/prumadas`). Ele informa que a conexão Cloudflare e a integração ainda não estão ativas e que a atualização de login precisa ser instalada e validada. A existência de código ou de uma URL não comprova um serviço publicado nem uma fonte operacional disponível.

As rotas usam sessão do próprio aplicativo e a autorização encontrada é por painel; não há contrato de sessão compartilhada, API de leitura para este dashboard ou autorização por UF. Esta integração é somente de navegação: não conectar o navegador diretamente às APIs de dados nem espelhar credenciais. A PR do Worker deve confirmar a autenticação e autorização da rota. Como não há escopo por UF no modelo atual, o Worker deve negar acesso a contas não mestre sem uma autorização explícita de estado atribuída e validada no servidor; nunca confiar em seleção ou dados de UF enviados pelo cliente. A implantação coordenada deve validar a disponibilidade e atualização das fontes antes do uso operacional. Se dados forem integrados futuramente, limitar campos ao necessário para os indicadores; contatos e telefones de endereços não são necessários para este painel.

## Requisitos para integração operacional

- Disponibilizar fontes reais com responsável, escopo por UF e timestamp de atualização. Indicar dados desatualizados explicitamente; nunca substituir falhas por valores fictícios.
- Implementar autenticação e autorização por perfil e UF no servidor. Não conceder acesso com base em nomes ou e-mails encontrados em documentos.
- Manter endereços e acesso separados de blocos liberados e obra. Distinguir produção de aprovação, medição, faturamento e recebimento.
- Não calcular FCMD ou ociosidade sem fontes reais validadas.
- Limitar projeções ao estoque liberado, equipes e agenda disponíveis.
- Tratar PR, SC e RS como o escopo regional, sem inventar metas, produção, equipes ou outros dados.

## Premissas de simulação

Somente para simulações: receita potencial de R$ 1.800 por unidade, valor do parceiro de R$ 900 por unidade, contribuição de R$ 900 por unidade e custo fixo de R$ 20.000 por UF/mês. Essas premissas não representam resultados reais e não alimentam os indicadores da página.

## Publicação

Esta alteração não configura nem executa deploy e não publica a rota do Worker. A página estática de entrada só pode ser publicada como parte do fluxo coordenado descrito acima; o painel operacional permanece bloqueado até a PR separada do Worker estar implantada e autenticada, com fontes reais, autorização server-side e validação apropriada. A entrada não é um painel operacional nem uma fonte de dados.
