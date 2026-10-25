# CLAUDE.md — Claude Code / KPI Regional Sul

Leia AGENTS.md e README.md. Trabalhe em branches por tarefa e PR draft para revisão do gestor.
- Restrinja sua atuação ao frontend e proxy do KPI autorizados; nunca altere Worker/D1 de produção implicitamente.
- Não exponha a sessão, senha ou segredos; fluxo login, /api/auth/me e permissões Master devem permanecer fail-closed.
- Projete mudanças considerando nulos, competência futura, estados sem dados, contagens derivadas e ausência de faturamento realizado.
- Execute e reporte testes reais via Node, sem afirmar sucesso de testes não executados.
- Planeje rollback e só publique mediante aprovação específica.
