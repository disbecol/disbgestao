# Validação 1.7.100 — 19/11/2026

## Alterações

- Padrão visual compartilhado inspirado na referência aprovada: superfícies neutras, bordas discretas, destaque verde-água, abas compactas e indicadores com ícones. Os temas claro e escuro mantêm as cores de status e de comparação com metas. As regras novas são restritas à tela, preservando impressão e assinatura.
- Pedidos: bloqueio de solicitações fora das janelas configuradas também para administradores, na interface e na RPC. A tela usa a hora do servidor, atualiza a disponibilidade sem apagar os campos e bloqueia o envio enquanto não consegue confirmar o horário.
- Pedidos: ranking por vendedor/RN-GV, em ordem decrescente de solicitações, respeitando os filtros. Solicitações administrativas não são contadas como vendedor.
- Entrega → Avarias de Entrega → Dashboard: Resumo, Trocas, Reposições, Motoristas, Clientes, Produtos, Cidades e Ano a ano. A fonte são os registros existentes; não exige upload de planilhas.

## Verificação automática e visual

- Suíte completa: `node --test --test-concurrency=2 tests/*.test.mjs` — **461 aprovados, nenhuma falha**.
- Após o ajuste final de disposição dos cards: **58 testes de apresentação e interface aprovados**, nenhuma falha.
- Testes de banco usam PGlite isolado. Cobrem o bloqueio de Admin às 13:20, permissões, unidades, acesso anônimo e limites do dashboard. Testes da interface cobrem abertura e fechamento por horário sem perder a digitação.
- Prévia local com os arquivos reais de apresentação e dados demonstrativos: inspecionados os dois temas, os cards, as abas de avarias e o ranking de Pedidos. Navegação da análise por clientes conferida no DOM. A instrumentação de viewport apresentou escala diferente da solicitada; não foi considerada prova de dimensões exatas de celular.
- Não houve teste de instalação em aparelho físico nem login de usuário de produção para validar a interface. Não foram criadas solicitações ou avarias de teste no banco real.

## Banco publicado

- Migrações aplicadas: `20261119162929_orders_strict_request_hours.sql` e `20261119165503_delivery_damage_dashboard.sql`.
- Dashboard usa SECURITY INVOKER, respeita RLS, unidade e permissões existentes; `anon` não pode executá-lo. A consulta agregada não retorna fotos, GPS nem assinaturas.
- Conferência após migrações: 88 registros de avaria e 93 itens; conteúdo dos itens preservado, hash `2f03a3466b9e8fe691d97235751aaa30`. Registros legados sem unidade não são atribuídos automaticamente.
- Os avisos do advisor de segurança mantiveram as mesmas contagens anteriores. Não houve mudança em dados de clientes, MAPAS ou planilhas do Google.

## APK

- `DisbGestao-1.7.100.apk`, versão Android 262, pacote `br.com.disbecol.gestaooperacional`.
- Compilação offline: `assembleDebug` concluída. Assinatura verificada, mesmo certificado de atualização anterior.
- SHA-256 do APK: `7c4117ab7bb3eb5f6c6b35015e34b5523dad6a8e00a8994fac455ffa24cbe332`.
- Conferidos byte a byte 19 arquivos embarcados, incluindo scripts, estilos, logos e imagens de produtos.
- Firebase Android continua sem `google-services.json`; notificações push remotas não foram habilitadas nesta versão.

## Limites dos indicadores

Ocorrência é um registro de avaria; caixas e unidades ficam separadas. Atendimento completo exige entrega de todos os itens válidos, sem contar cancelados e reprovados. Prazo médio usa registro e entrega efetiva, quando ambas as datas existem. A base atual não contém custo em R$, HL, categoria Ambev/Marketplace ou pré-rota, portanto esses valores não são estimados. A planilha fornecida orientou as visualizações e não foi importada.
