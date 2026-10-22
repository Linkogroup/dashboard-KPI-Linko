# KPI F4A — Linko Group | Regional Sul

## Estado atual

O repositório contém uma página estática (`index.html`) e uma regra da Vercel que encaminha as rotas para essa página. Não há função server-side/API Vercel, mecanismo de autenticação ou proxy para a fonte de dados. Por isso, o site não consegue buscar nem exibir os indicadores operacionais.

O painel permanece sem dados operacionais; valores simulados não são usados como fallback. A página não autentica usuários e não deve receber credenciais ou dados reais no navegador.

## Diagnóstico da conexão

A versão atual do Worker (`2b2ba564`, conforme informado pela equipe responsável) não disponibiliza `/api/dashboard-kpi`; essa rota existiu somente em uma versão posteriormente revertida. Os endpoints autenticados atualmente disponíveis para endereços e prumadas (`/api/enderecos` e `/api/prumadas`) dependem de uma sessão do próprio Worker. Não há contrato de sessão compartilhada nem interface autenticada server-to-server documentada para a Vercel. Este repositório também não possui backend/proxy que possa obter e manter essa sessão. O navegador não pode ler respostas do Worker por cross-origin, e adicionar somente CORS não resolveria a autenticação.

O erro observado em `https://kpi.f4aconsultoria.com.br/` é a própria página estática de indisponibilidade: ela informa que a integração não está configurada e apresenta os indicadores como indisponíveis. Não foi observado erro de JavaScript nem feita chamada aos endpoints do Worker. A causa é que a rota KPI não existe na versão atual e os endpoints existentes não oferecem uma interface de autenticação adequada para um servidor Vercel sem mudança no Worker; não é a ausência de números simulados.

## Requisitos externos para habilitar a integração

- Sem alteração no Worker, a integração só poderá avançar se já existir ou for disponibilizada fora dele uma interface/gateway aprovada, autenticada server-to-server e com acesso autorizado aos KPIs. Os endpoints atuais de endereços/prumadas usam a sessão própria do Worker e não constituem essa interface. Não se presume nem se inventa token, segredo, endpoint de login ou compartilhamento de sessão.
- O responsável pela fonte externa deve documentar o esquema real da resposta KPI, os campos permitidos para o painel, o escopo de autorização PR/SC/RS e o timestamp/validade dos dados. A resposta encaminhada deve conter apenas dados necessários aos KPIs, nunca credenciais ou PII.
- Somente após esse contrato e interface serem disponibilizados, implementar uma função server-side no projeto Vercel para autenticar, validar e filtrar a resposta. Segredos devem ser configurados pelo administrador nos mecanismos protegidos da Vercel, nunca no HTML, no browser, no repositório ou em logs.
- Confirmar controle de acesso por perfil e UF no servidor. Não confiar em seleções enviadas pelo cliente e não exibir valores de simulação se autenticação, autorização ou leitura falhar.
- Validar o proxy e o tratamento de sessão/cookies em preview antes de qualquer publicação; se necessário, definir com os responsáveis os domínios, atributos e ciclo de vida dos cookies. Esta tarefa não modifica nem implanta o Worker.

## Premissas de simulação

As premissas de simulação exibidas na página não representam resultados reais e não alimentam os indicadores.

## Publicação

Não foi possível concluir a conexão neste repositório: a versão atual do Worker não tem a rota `/api/dashboard-kpi`, e seus endpoints autenticados atuais não oferecem uma interface apropriada para integração server-side Vercel. A PR #2, que apenas adiciona um link para uma rota do Worker, não integra dados à página Vercel. Nenhuma alteração ou chamada foi feita ao Worker; este trabalho também não executa deploy.
