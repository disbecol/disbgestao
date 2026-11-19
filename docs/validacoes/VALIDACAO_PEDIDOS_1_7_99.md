# Validação Pedidos 1.7.99

19/11/2026. Menu: **Pedidos → Pedidos fora de rota**. Oito telas: Nova solicitação, Minhas solicitações, Fila de análise, Gestão de solicitações, Dashboard, Minha produtividade, Auditoria e Configurações.

- Suite completa: **438 aprovados, zero falhas**, `node --test --test-concurrency=2 tests/*.test.mjs`.
- Os 25 testes específicos de Pedidos incluem banco isolado PGlite, regras de prazo e horário, autorização por usuário/unidade, concorrência, idempotência, oito telas DOM, exportação e contraste claro/escuro em 390/1280 px.
- Compilação Android concluída: `assembleDebug --offline`; app `br.com.disbecol.gestaooperacional`, versionName `1.7.99`, versionCode `261`.
- APK: 83.749.078 bytes; SHA-256 `78cbe3354b61313e3189af8c5fec09cabcd654aad55731a5a91d02ba0b5732f8`.
- Assinatura Android verificada, com o mesmo certificado das versões anteriores. Os arquivos de Pedidos e os demais assets selecionados foram comparados byte a byte entre fonte e APK.
- Migração Supabase aplicada e registrada em `20261119143241_orders_requests.sql`. Quatro tabelas com RLS, oito funções sem EXECUTE para anon. Nenhuma escrita direta concedida a authenticated. Perfil, permissão, módulo e unidade verificados no servidor.
- Instalação deixou **zero pedidos e zero eventos de auditoria** de teste no banco real.
- Clientes: 3.530 linhas; hash antes/depois `a23bdbe2880219457a0cbf0da637d270`. MAPAS: 446 linhas; hash antes/depois `14deeb4193e4c5efab46876c143d107b`.
- [Advisors de segurança](https://supabase.com/docs/guides/database/database-linter): não houve novos avisos de execução anônima ou search_path mutável. Oito avisos de RPC SECURITY DEFINER autenticada são intencionais: endpoints guardados que executam operações atômicas sem conceder escrita direta. A tabela interna de idempotência tem RLS sem política e sem grants, também intencional.
- O navegador integrado falhou ao iniciar. Não houve validação visual interativa nem instalação/teste em aparelho físico; foram executados os testes DOM, de regras, banco e cascata de estilos descritos acima. A referência foi analisada por arquivos públicos e funções HTTP de leitura/autenticação com a conta autorizada.

Não há integração de escrita automática no BEES. A aprovação registra a confirmação de trabalho manual. Pedidos exige conexão para enviar; tentativas após falha reutilizam a chave de operação, preservando os textos na tela enquanto ela permanecer aberta.
