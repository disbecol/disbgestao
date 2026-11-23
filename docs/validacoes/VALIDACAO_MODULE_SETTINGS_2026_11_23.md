# Correção de module_settings_name_valid — 23/11/2026

O SQL 87 fornecido recriava a lista de módulos sem `Pedidos`. Quando essa linha já existia, PostgreSQL recusava a nova restrição com SQLSTATE 23514 e revertia a transação. A inspeção de produção confirmou que `Pedidos` é exatamente o nome rejeitado pela lista antiga.

## Alterações

- O arquivo de instalação inicial `87_delivery_returns.sql` aceita `Pedidos` e interrompe a execução antes de alterar qualquer objeto quando Devoluções já está instalado. Isso evita sobrescrever funções incrementais recentes ao repetir o pacote inicial.
- A migração `20261123105236_module_settings_names_compatibility.sql`, gerada pela CLI oficial, corrige apenas a restrição. Preserva os nomes já aceitos e acrescenta Devoluções/Pedidos se necessário; não insere, ativa, desativa nem exclui módulos. Uma restrição já compatível não é alterada.
- A documentação diferencia instalação inicial e correção isolada.

## Verificação

`node --test --test-concurrency=1 tests/module-settings-database.test.mjs tests/returns-database.test.mjs tests/returns-penalties-database.test.mjs`: **45 testes aprovados**, nenhuma falha. O ajuste final posterior alterou somente o caminho exibido na mensagem de erro, mantendo o identificador validado pelo teste.

Os testes PGlite reproduzem o erro 23514, validam o reparo repetível, preservam módulos adicionais e estados inativos, mantêm a rejeição de nomes inválidos e verificam rollback se houver dados incompatíveis. Também verificam a proteção contra reinstalação, RLS/unidades, auditoria, prioridades, devolução parcial e penalidades.

No Supabase conectado, somente consultas de diagnóstico foram executadas. A restrição atual já está validada e aceita Devoluções e Pedidos; o módulo já está instalado. Devolução parcial e consulta de prioridades por rota continuam presentes. **Nenhuma migração ou alteração de dados foi executada nesse projeto**, pois o reparo de esquema não é necessário nele. O SQL isolado fica disponível para bases que ainda precisem de compatibilidade.

Não houve alteração de frontend ou APK nesta correção.
