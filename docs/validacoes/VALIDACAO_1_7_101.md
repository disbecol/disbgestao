# Validação 1.7.101 — 19/11/2026

Ajuste visual dos gráficos de barras do Dashboard de Avarias para o padrão de Devoluções solicitado: nome e valor alinhados acima da barra de largura integral, altura de 7px e cores azuis nos temas claro e escuro. O mesmo componente atende produtos, cidades, motoristas, clientes e distribuições. Nomes longos quebram linha, com espaço separado para o valor.

- 21 testes existentes de interface, acesso, empacotamento e contraste passaram: `node --test --test-concurrency=2 tests/damage-dashboard-ui.test.mjs tests/appearance.test.mjs`.
- Prévia local com dados demonstrativos: gráficos de produtos conferidos nos dois temas; alinhamento de nomes e valores e altura das barras verificados no navegador. Navegação da aba Cidades conferida. Captura local em `tmp/avarias-produtos-1.7.101.jpg`.
- Nenhum cálculo, filtro, permissão, dado ou endpoint foi alterado; não há migração de banco nesta versão.
- APK Android: versão 1.7.101, código 263. A validação do pacote e dos arquivos públicos fica em `tmp/apk-1.7.101-validation.json` e `tmp/release-1.7.101-validation.json` após geração e publicação.
