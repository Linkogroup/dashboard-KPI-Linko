# KPI F4A — Linko Group | Regional Sul

## Estado atual

O repositório contém uma página estática (`index.html`) e uma regra da Vercel que encaminha as rotas para essa página. Não foram encontrados aplicação de servidor, API, banco de dados, mecanismo de autenticação, pipeline de deploy ou testes automatizados.

O painel foi mantido sem dados operacionais até que fontes reais e controles de acesso estejam disponíveis. Números, metas, parceiros, equipes, SLAs e gráficos anteriormente embutidos na página não eram provenientes de uma integração verificável e foram removidos. A página não autentica usuários nem deve receber dados reais.

## Fonte candidata identificada

`Linkogroup/f4a-paineis` contém código para um Worker Cloudflare com D1 e rotas autenticadas de endereços (`/api/enderecos`) e produção (`/api/prumadas`). O repositório informa que a conexão Cloudflare e a integração ainda não estão ativas e que a atualização de login precisa ser instalada e validada. A existência dessas rotas no código não comprova um serviço publicado nem uma fonte operacional disponível.

As rotas usam sessão do próprio aplicativo e a autorização encontrada é por painel; não há contrato de sessão compartilhada, API de leitura para este dashboard ou autorização por UF. Não conectar o navegador diretamente à API nem espelhar suas credenciais. Uma futura integração precisa confirmar a implantação e atualização dos dados de origem, definir autenticação servidor-a-servidor e autorização PR/SC/RS no servidor, e limitar os campos transferidos ao necessário para os indicadores. Contatos e telefones de endereços não são necessários para este painel.

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

Esta alteração não configura nem executa deploy. Uma publicação operacional fica bloqueada até que haja integração real de dados, autorização server-side e um fluxo de deploy e validação apropriado. A página estática atual é apenas um estado explícito de indisponibilidade, não um painel operacional pronto para produção.
