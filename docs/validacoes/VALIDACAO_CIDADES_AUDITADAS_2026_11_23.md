# Nomes de cidades nas devoluções auditadas — 23/11/2026

O banco possuía o helper de nomes, mas `returns_enrich` estava novamente com o corpo legado do SQL 88, priorizando códigos da base de pedidos sobre os nomes do cadastro. Isso fazia a lista auditada receber valores como RN00007148 e RN00007161.

## Correção

Aplicada a migração `20261123111612_returns_city_names_restore`. Restaura a função de leitura já usada pelo cadastro atualizado: ignora códigos quando há um nome válido, consulta o cadastro da mesma unidade e aceita associação de código apenas quando o nome correspondente é inequívoco. Recupera também a data de cadastro para os indicadores de clientes novos. Os filtros por nota, mapa, data e unidade e os dados de equipe e auditoria permanecem como na versão corrigida anterior.

A migração verifica o hash do corpo atual antes de substituir a função, aceitando somente as versões legadas conhecidas e a própria versão restaurada. Os helpers continuam sem execução direta por anon ou authenticated, com `search_path` fixo. O SQL 88 agora é protegido contra reinstalação, para evitar que substitua funções incrementais novamente.

## Validação

- **48 testes aprovados**, nenhuma falha: `node --test --test-concurrency=1 tests/returns-database.test.mjs tests/returns-penalties-database.test.mjs tests/module-settings-database.test.mjs`.
- Regressão reproduz código incorreto na RPC usada pela auditoria, aplica a migração e confirma o nome e a data de cadastro. Também verifica reaplicação, rejeição de código fonte desconhecido, preservação das bases e auditorias, isolamento entre unidades e proteção ao repetir o SQL 88.
- Em produção: **66 registros retornam nome de cidade, zero códigos e zero cidades vazias**. Exemplos confirmados: CAICO, CURRAIS NOVOS, SANTA CRUZ e TENENTE LAURENTINO CRUZ.
- Hashes das tabelas de clientes, MAPAS, bases de Devoluções e casos de auditoria idênticos aos anteriores. Contagens preservadas: 3.530 clientes, 446 mapas, 4.744 registros importados, dois casos e dez eventos de auditoria. Nenhuma linha foi criada ou alterada para testar a correção.
- Advisor de segurança com as mesmas contagens anteriores. Nenhum novo acesso ou permissão concedido.

Não houve alteração de frontend ou APK. Atualizar a consulta da tela já carrega os nomes corrigidos.
