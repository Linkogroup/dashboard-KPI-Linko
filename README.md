# KPI F4A — Linko Group | Regional Sul

## Integração no Vercel

O painel continua hospedado em `kpi.f4aconsultoria.com.br`; o Worker é somente a fonte de consulta e não é alterado por este projeto. As funções Node em `api/` fazem um proxy server-side para o host fixo do Worker. Não há fetch do browser para `workers.dev`, CORS permissivo, token embutido ou segredo de integração.

O login envia e-mail e senha por HTTPS ao endpoint same-origin `/api/auth/login`. A função encaminha o corpo somente a `POST /api/auth/login` no Worker, define `Origin` igual à origem fixa do Worker (requisito do login existente), desativa redirects e não registra corpo, senha, resposta da sessão ou cookie. A senha necessariamente transita e é processada em memória pelo serviço Vercel; esta arquitetura só é aceitável se a organização confiar a Vercel como processadora de credenciais e tiver controles de acesso/observabilidade apropriados para esse projeto. O código não persiste nem registra a senha. Ela exige o `Set-Cookie` esperado (`__Host-f4a_session`, token hexadecimal de 64 caracteres, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`, validade de 8 horas e sem `Domain`) e o converte em cookie host-only com os mesmos atributos para o domínio KPI.

Após login e em cada consulta, o proxy valida a sessão via `GET /api/auth/me` e permite somente `accessProfile === "master"` com `mustChange === false`. Perfil ausente, resposta inesperada ou endpoint indisponível falham fechados; uma sessão recusada não é emitida ao browser. Logout same-origin envia `POST /api/auth/logout` ao Worker e apaga o cookie local. Senhas e tokens não são persistidos em Vercel storage, `localStorage`, HTML ou logs da aplicação.

O fluxo usa a autenticação já existente: um login válido cria um registro normal em `auth_sessions` no D1 do Worker; logout e sessões não autorizadas tentam revogar esse registro pelo endpoint existente. Não há migração, alteração de schema ou escrita em dados operacionais. Se a restrição de “nenhuma alteração no D1” também proibir esses registros de sessão nativos, este desenho não pode ser ativado.

O endpoint Vercel `GET /api/kpi` usa uma allowlist fixa para chamar somente `GET /api/enderecos` e `GET /api/prumadas`, sempre com a sessão Worker mantida no cookie HttpOnly do domínio KPI. A função agrega exclusivamente PR/SC/RS e retorna contagens, metas, produção derivada, revisões e limitações. Identificadores, endereços, nomes, contatos, telefones, notas e registros detalhados não são incluídos no JSON do browser. Os dados brutos são processados apenas em memória na função; respostas são `no-store`. A atualização operacional continua submetida às permissões próprias do Worker.

O login e logout exigem `Origin` exatamente igual ao host KPI autorizado, HTTPS em produção, `Content-Type: application/json` e `Sec-Fetch-Site` same-origin quando presente. A função não habilita CORS. Hosts permitidos são o domínio de produção e os hosts de deployment/produção fornecidos pelo Vercel; localhost só é aceito fora de produção. Upstream usa origem fixa, caminhos allowlisted, timeout e `redirect: manual`.

## Verificação da fonte e limites de implantação

O código versionado do Worker lido para esta integração contém `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/enderecos` e `GET /api/prumadas`. O endpoint antigo `/api/dashboard-kpi` **não é chamado** por este projeto. Os GETs públicos sem sessão retornaram 401 para APIs de dados; isso confirma que a camada de autenticação responde, mas não permite verificar sem login se cada rota está ativa no deployment. O hash `2b2ba564` informado pela equipe não foi resolvido como commit no repositório GitHub acessível. Portanto a disponibilidade do `/api/auth/me` e das rotas de dados na versão Cloudflare ativa deve ser confirmada pelo responsável do Worker durante a validação autorizada de preview; qualquer ausência retorna erro, sem dado fictício.

O Worker aplica limite por IP e por e-mail no login. Quando o login é encaminhado pelo Vercel, a origem de rede vista pelo Worker é o egress do Vercel e não o IP original do browser; a cota por IP pode ser compartilhada e causar bloqueios entre usuários. Não encaminhamos nem falsificamos `CF-Connecting-IP`. Antes de uma publicação operacional, o administrador deve confirmar se o limite atual é aceitável ou configurar rate limiting na borda Vercel, e verificar que a versão Worker ativa mantém login, sessão `/api/auth/me` e as duas rotas de leitura.

O Worker não oferece autorização por UF para este painel; por segurança, o proxy permite somente Gestor Master e a resposta é filtrada para PR, SC e RS. Produção é derivada dos registros disponíveis e não comprova execução física; atualidade da fonte é não verificada. FCMD, ociosidade, equipes, agenda, projeções, faturamento e recebimentos permanecem indisponíveis. Valores de simulação nunca são usados como fallback.

## Testes e publicação

Execute `node --test tests/worker-proxy.test.cjs` para testar origem/CSRF, cookies, redirects, sessão Master fail-closed, allowlist, agregação sem PII e falhas de revisão com respostas simuladas. Os testes não enviam credenciais nem fazem chamadas ao Worker. As verificações de preview do Vercel não equivalem a um login real autorizado.

Esta mudança não altera nem implanta o Worker e não configura credenciais no Vercel. Nenhum merge ou deploy de produção deve ocorrer até a revisão de segurança, confirmação autorizada das rotas na versão Worker ativa, verificação do limite por IP compartilhado e teste de preview por um Gestor Master. Nunca coloque credenciais no chat; a senha é digitada somente no formulário do domínio KPI.
