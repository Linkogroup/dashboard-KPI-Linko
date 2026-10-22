# KPI F4A — Linko Group | Regional Sul

## Estado atual

O repositório contém uma página estática (`index.html`) e uma regra da Vercel que encaminha as rotas para essa página. Não há função server-side/API Vercel, mecanismo de autenticação ou proxy para a fonte de dados. Por isso, o site não consegue buscar nem exibir os indicadores operacionais.

O painel permanece sem dados operacionais; valores simulados não são usados como fallback. A página não autentica usuários e não deve receber credenciais ou dados reais no navegador.

## Diagnóstico da conexão

A fonte definida é `GET /api/dashboard-kpi` no Worker `f4a-paineis`. Essa rota exige uma sessão autenticada no próprio Worker, e o Worker não fornece CORS. Este repositório não possui um backend que possa autenticar-se na fonte ou manter uma sessão dela. O navegador não pode ler a resposta dessa origem, e a página não tem a sessão necessária; adicionar somente CORS não resolveria a autenticação.

O erro observado em `https://kpi.f4aconsultoria.com.br/` é a própria página estática de indisponibilidade: ela informa que a integração não está configurada e apresenta os indicadores como indisponíveis. Não foi observado erro de JavaScript nem feita chamada ao endpoint do Worker. A causa é a ausência de um fluxo server-side autenticado entre a Vercel e a sessão local exigida pelo Worker, não a ausência de números simulados.

## Requisitos externos para habilitar a integração

- O responsável pelo Worker deve fornecer e validar um protocolo de autenticação server-to-server ou um fluxo de sessão que possa ser terminado com segurança por um proxy. Não se presume nem se inventa token, segredo, endpoint de login ou compartilhamento de sessão.
- O responsável pela fonte deve documentar o esquema real da resposta de `/api/dashboard-kpi`, os campos permitidos para o painel, o escopo de autorização PR/SC/RS e o timestamp/validade dos dados. A resposta encaminhada deve conter apenas dados necessários aos KPIs, nunca credenciais ou PII.
- Com esse contrato, implementar uma função server-side no projeto Vercel para autenticar, validar e filtrar a resposta. Segredos devem ser configurados pelo administrador nos mecanismos protegidos da Vercel, nunca no HTML, no browser, no repositório ou em logs.
- Confirmar controle de acesso por perfil e UF no servidor. Não confiar em seleções enviadas pelo cliente e não exibir valores de simulação se autenticação, autorização ou leitura falhar.
- Validar o proxy e o tratamento de sessão/cookies em preview antes de qualquer publicação; se necessário, definir com os responsáveis os domínios, atributos e ciclo de vida dos cookies. Esta tarefa não modifica nem implanta o Worker.

## Premissas de simulação

As premissas de simulação exibidas na página não representam resultados reais e não alimentam os indicadores.

## Publicação

Não foi possível concluir a conexão neste repositório sem o protocolo de autenticação e o contrato de resposta mantidos pelo Worker. A PR #2, que apenas adiciona um link para uma rota do Worker, não integra os dados à página Vercel e não atende ao requisito de manter o Worker como fonte e o site KPI como painel. Nenhuma alteração, chamada mutável ou implantação foi feita no Worker; este trabalho também não executa deploy de produção.
