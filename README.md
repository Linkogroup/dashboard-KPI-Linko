# KPI F4A — Linko Group | Regional Sul

## Integração no Vercel

O painel continua hospedado em `kpi.f4aconsultoria.com.br`; o Worker é somente a fonte de consulta e não é alterado por este projeto. As funções Node em `api/` fazem um proxy server-side para o host fixo do Worker. Não há fetch do browser para `workers.dev`, CORS permissivo, token embutido ou segredo de integração.

O login envia e-mail e senha por HTTPS ao endpoint same-origin `/api/auth/login`. A função encaminha o corpo somente a `POST /api/auth/login` no Worker, define `Origin` igual à origem fixa do Worker (requisito do login existente), desativa redirects e não registra corpo, senha, resposta da sessão ou cookie. A senha necessariamente transita e é processada em memória pelo serviço Vercel; esta arquitetura só é aceitável se a organização confiar a Vercel como processadora de credenciais e tiver controles de acesso/observabilidade apropriados para esse projeto. O código não persiste nem registra a senha. Ela exige o `Set-Cookie` esperado (`__Host-f4a_session`, token hexadecimal de 64 caracteres, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`, validade de 8 horas e sem `Domain`) e o converte em cookie host-only com os mesmos atributos para o domínio KPI.

Após login e em cada consulta, o proxy valida a sessão via `GET /api/auth/me` e permite somente `accessProfile === "master"` com `mustChange === false`. Perfil ausente, resposta inesperada ou endpoint indisponível falham fechados; uma sessão recusada não é emitida ao browser. Logout same-origin envia `POST /api/auth/logout` ao Worker e apaga o cookie local. Senhas e tokens não são persistidos em Vercel storage, `localStorage`, HTML ou logs da aplicação.

O fluxo usa a autenticação já existente: um login válido cria um registro normal em `auth_sessions` no D1 do Worker; logout e sessões não autorizadas tentam revogar esse registro pelo endpoint existente. Não há migração, alteração de schema ou escrita em dados operacionais. Se a restrição de “nenhuma alteração no D1” também proibir esses registros de sessão nativos, este desenho não pode ser ativado.

O endpoint Vercel `GET /api/kpi` usa uma allowlist fixa para chamar somente `GET /api/enderecos` e `GET /api/prumadas`, sempre com a sessão Worker mantida no cookie HttpOnly do domínio KPI. A função agrega exclusivamente PR/SC/RS e retorna contagens, metas, produção derivada, revisões e limitações. Identificadores, endereços, nomes, contatos, telefones, notas e registros detalhados não são incluídos no JSON do browser. Os dados brutos são processados apenas em memória na função; respostas são `no-store`. A atualização operacional continua submetida às permissões próprias do Worker.

O login e logout exigem `Origin` exatamente igual ao host KPI autorizado, HTTPS em produção, `Content-Type: application/json` e `Sec-Fetch-Site` same-origin quando presente. A função não habilita CORS. Hosts permitidos são o domínio de produção e os hosts de deployment/produção fornecidos pelo Vercel; localhost só é aceito fora de produção. Upstream usa origem fixa, caminhos allowlisted, timeout e `redirect: manual`.

## Verificação da fonte e limites de implantação

O código versionado do Worker lido para esta integração contém `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/enderecos` e `GET /api/prumadas`. O endpoint antigo `/api/dashboard-kpi` **não é chamado** por este projeto. O usuário confirmou que o login Master e a carga dos indicadores já funcionavam em produção antes desta atualização visual. Isso não significa que esta branch ou seu pacote de gráficos tenha sido implantado. O hash `2b2ba564` informado pela equipe não foi resolvido como commit no repositório GitHub acessível; nenhuma chamada ou alteração no Worker é necessária para esta atualização de interface.

O Worker aplica limite por IP e por e-mail no login. Quando o login é encaminhado pelo Vercel, a origem de rede vista pelo Worker é o egress do Vercel e não o IP original do browser; a cota por IP pode ser compartilhada e causar bloqueios entre usuários. Não encaminhamos nem falsificamos `CF-Connecting-IP`. Antes de uma publicação operacional, o administrador deve confirmar se o limite atual é aceitável ou configurar rate limiting na borda Vercel, e verificar que a versão Worker ativa mantém login, sessão `/api/auth/me` e as duas rotas de leitura.

O Worker não oferece autorização por UF para este painel; por segurança, o proxy permite somente Gestor Master e a resposta é filtrada para PR, SC e RS. Produção é derivada dos registros disponíveis e não comprova execução física; atualidade da fonte é não verificada. FCMD, ociosidade, medição, equipes, supervisores, parceiros, agenda, alertas, ações, capacidade, previsões e financeiro realizado permanecem indisponíveis. Valores de simulação nunca são usados como fallback.

## Indicadores, relatórios e simulador

A página apresenta gráficos acessíveis de distribuição de status de endereços por UF e de meta versus produção derivada por período, além de tabelas com contagens por estado e detalhes do período selecionado. Filtros de abrangência e mês afetam os gráficos e o recorte tabular. As tabelas permanecem roláveis horizontalmente em telas estreitas; a interface adapta cartões e formulários para telas móveis e permite imprimir um resumo do recorte. O resumo impresso é uma fotografia da consulta, não um relatório diário: a fonte não oferece série diária validada nem data que confirme atualidade.

Endereços e blocos liberados são exibidos separadamente. Metas ausentes e produção não calculável permanecem como “Não disponível”; nenhum valor indisponível é convertido para zero. A produção é derivada de endereços atualmente concluídos e de transições registradas, e não equivale a execução física, medição, aprovação, faturamento ou recebimento.

A matriz de disponibilidade identifica módulos sem fonte integrada: série diária observada, medição/execução física, backlog/capacidade, equipes/supervisores/parceiros, agenda/alertas/ações, FCMD/ociosidade, financeiro realizado/receita efetiva, faturamento/cobrança, contas a receber/recebimentos/pagamentos, previsões e administração. Esses módulos não geram séries, alertas ou classificações fictícias.

O simulador financeiro é hipotético, editável e independente dos dados operacionais. Começa com as premissas autorizadas de receita potencial de R$ 1.800/unidade, parceiro de R$ 900/unidade, contribuição de R$ 900/unidade e custo fixo de R$ 20.000 por UF/mês. Unidades são informadas manualmente, sem vínculo ou equivalência presumida com endereços ou blocos; receita, contribuição e saldo nunca são apresentados como realizados ou previstos. A contribuição editada é mostrada separadamente da diferença entre receita e parcela do parceiro.

## Testes e publicação

Execute `node --test tests/worker-proxy.test.cjs tests/dashboard-simulator.test.cjs` para validar origem/CSRF, cookies, redirects, sessão Master fail-closed, allowlist, agregação sem PII, falhas de revisão, ausência de metas, parsing de valores, matemática do simulador, estados indisponíveis e acessibilidade responsiva da interface. Os testes não enviam credenciais nem fazem chamadas ao Worker.

Esta aplicação não altera nem implanta o Worker e não configura credenciais no Vercel. A publicação desta interface deve ocorrer somente pelo fluxo aprovado do projeto Vercel; após merge, confirme o resultado do deployment antes de afirmar que está em produção. Nunca coloque credenciais no chat; a senha é digitada somente no formulário do domínio KPI.
