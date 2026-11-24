# Direção visual do Disb Gestão

Aplicativo de trabalho para armazém, entrega, vendas e motoristas. A informação e a ação da etapa atual têm prioridade sobre decoração. A referência indicada foi o Disbecol ERP: fundos neutros, hierarquia clara, cards compactos, navegação agrupada e poucos pontos de destaque.

As orientações de [Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) e [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md) foram consultadas na revisão. A pesquisa de sistema visual retornou Minimalism & Swiss Style para ferramentas empresariais. As sugestões de landing page, fontes monoespaçadas e CTA laranja foram descartadas porque o produto é uma ferramenta operacional com direção visual já definida pelo usuário.

## Paleta e tipografia

| Papel | Claro | Escuro |
|---|---|---|
| Fundo | `#f6f7f9` | `#101319` |
| Superfície | `#ffffff` | `#1b2029` |
| Texto | `#28313d` | `#e6eaf0` |
| Texto auxiliar | `#626e7e` | `#a8b2c1` |
| Ação principal | `#147d87` | `#68c9c7` |
| Borda | `#dce1e7` | `#303947` |

DM Sans para leitura e controles; Manrope para títulos e indicadores. Corpo de 15 px, campos de 14 px no computador e 16 px no celular. Tabelas usam uma escala compacta apropriada para dados; títulos variam de 23 a 28 px. Fontes locais, disponíveis offline, com `font-display: swap`.

Verde, vermelho e âmbar indicam situações acompanhadas de texto. Os gráficos podem distinguir séries com cores adicionais. A assinatura permanece branca e os documentos impressos têm estilo próprio.

## Organização

```text
Menu: área > módulo > página
Conteúdo: título > filtros > indicadores ou lista > ação da etapa
Avaria: Produtos e ações | Dados e documentos
NRI: Carreta > lista de produtos em código decrescente
```

Alinhamento à esquerda e espaços recorrentes de 4, 8, 12, 16, 24 e 32 px. Listas densas ficam em seus contêineres de rolagem; a página não deve ganhar rolagem lateral. Controles principais de toque têm altura mínima de 48 px. Estados mantêm nomes, foco visível e semântica de botão. Ícones novos usam traços vetoriais consistentes. Movimento reduzido é respeitado.

## Evidência e limites

Testes de contraste cobrem navegação, formulários, tabelas, estados, detalhes de avarias, dashboard e configurações da Puxada nos dois temas. As páginas principais da nova Puxada, o detalhe de avaria e a lista expansível de NRI foram revisados no navegador, inclusive em largura de celular. Os demais módulos são atendidos pela camada compartilhada e pelos testes representativos; não foi feita uma revisão manual de cada combinação de dados e permissões. Não houve teste físico de acessibilidade ou de tamanho de fonte do Android.
