# Instalação do Apontamento Fora do Raio — 23/11/2026

O erro `Could not find the table 'public.delivery_radius_reports' in the schema cache` ocorreu porque a tabela e as RPCs do FDR ainda não existiam no projeto conectado. Devoluções já estava instalado; repetir seu SQL inicial não resolveria a falta do FDR.

## Correção aplicada

- Corrigida a lista de módulos no SQL 89 para preservar `Pedidos` ao incluir `Apontamento Fora do Raio`.
- Instalação aplicada pela integração Supabase e registrada como `20261123110403_delivery_radius_reports_installation`, com o conteúdo do SQL 89 corrigido. Cria a tabela, índices, permissões e funções específicas do FDR. A migração também notifica PostgREST para recarregar o esquema.
- O módulo fica ativo. As duas novas permissões são atribuídas ao papel ADMIN; os demais perfis continuam dependendo das permissões individuais existentes.
- RLS habilitado; consulta autenticada usa `fdr_can(unit,'FDR_VIEW')`. Gravação direta e acesso anônimo são negados. As RPCs validam perfil ativo, unidade, permissão, disponibilidade do módulo e revisão de edição; possuem `search_path` fixo.

## Verificação

`node --test --test-concurrency=1 tests/fdr-database.test.mjs tests/fdr.test.mjs tests/module-settings-database.test.mjs`: **11 testes aprovados**, nenhuma falha. A instalação é testada com Pedidos e Formulários previamente inativos, além de consulta automática, revisão concorrente, RLS, isolamento entre unidades e reaplicação sem perda dos apontamentos.

Produção: tabela e RPCs presentes, restrição dos módulos validada e zero apontamentos fictícios. Confirmados 3.530 clientes e 446 mapas com os mesmos hashes anteriores; 4.744 linhas de bases de Devoluções e dois casos preservados. O hash das funções `returns_*` permaneceu `44d0a7cbd1ce6c35a6d8a8b4944f2f7d`.

A API REST reconhece a tabela: a consulta anônima retorna `42501 / permission denied for table delivery_radius_reports` (HTTP 401), conforme a proteção configurada, em lugar de tabela ausente no cache. A verificação não utiliza sessão de usuário nem cria registros.

Advisor de segurança: sem novas ocorrências de execução anônima, RLS ausente ou `search_path` mutável. As três novas rotinas autenticadas SECURITY DEFINER são as do FDR, com as verificações de acesso acima; o restante dos avisos manteve suas contagens.

Não houve mudança de frontend ou APK. Basta atualizar a página para carregar o módulo instalado.
