# Direção visual do Disb Gestão

Aplicativo de trabalho para armazém, entrega, vendas e motoristas. A informação e a ação da etapa atual têm prioridade sobre decoração. A referência indicada foi o Disbecol ERP: fundos neutros, hierarquia clara, cards compactos, navegação agrupada e poucos pontos de destaque.

As orientações de [Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) e [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md) foram consultadas na revisão. A pesquisa de sistema visual retornou Minimalism & Swiss Style para ferramentas empresariais. As sugestões de landing page, fontes monoespaçadas e CTA laranja foram descartadas porque o produto é uma ferramenta operacional com direção visual já definida pelo usuário.

## Paleta e tipografia

| Papel | Claro | Escuro |
|---|---|---|
| Fundo | `#f6f7f9` | `#0f1117` |
| Superfície | `#ffffff` | `#191d26` |
| Texto | `#242833` | `#e6e8ee` |
| Texto auxiliar | `#626976` | `#aab0bd` |
| Ação principal | `#5552c9` | `#b5afff` |
| Borda | `#dfe2e8` | `#303541` |

Inter variável, hospedada no próprio aplicativo, para leitura, controles, títulos e indicadores. Corpo de 15 px, campos de 14 px no computador e 16 px no celular. Tabelas usam uma escala compacta apropriada para dados; títulos variam de 23 a 28 px. Fontes locais, disponíveis offline, com `font-display: swap`.

Verde, vermelho e âmbar indicam situações acompanhadas de texto. Os gráficos podem distinguir séries com cores adicionais. A assinatura permanece branca e os documentos impressos têm estilo próprio.

## Organização

```text
Menu: área > módulo > página
Conteúdo: título > filtros > indicadores ou lista > ação da etapa
Avaria: Produtos e ações | Dados e documentos
NRI: Carreta > lista de produtos em código decrescente
```

Alinhamento à esquerda e espaços recorrentes de 4, 8, 12, 16, 24 e 32 px. Listas densas ficam em seus contêineres de rolagem; a página não deve ganhar rolagem lateral. Campos no celular têm altura mínima de 48 px e botões de ação, 46 px. Estados mantêm nomes, foco visível e semântica de botão. Ícones novos usam traços vetoriais consistentes. Movimento reduzido é respeitado.

## Evidência e limites

Na versão 1.7.110 foram inventariados os 74 destinos atuais e revisadas suas telas, além do login e da análise por raio. As oito rotas de análises de Devoluções são apresentadas como abas de Acompanhamentos. Sete rotas antigas da Puxada apenas redirecionam para as seis páginas atuais e não são telas adicionais. A revisão usa os renderizadores reais, dados fictícios e bloqueio de gravações/conexão com produção. O registro por página está em [ui-screen-review.md](ui-screen-review.md).

Foram verificados temas claro/escuro, computador/celular, contagens em andamento, relatórios, consultas, configurações e janelas de edição. Testes cobrem contraste, preservação dos controles e permissões, disponibilidade offline dos estilos/fontes e os fluxos existentes. Isso não constitui teste de todas as combinações possíveis de dados ou de instalação/acessibilidade em aparelho físico. Nenhum registro ou esquema de produção foi alterado nesta revisão visual.
