# Comprovante de avaria em PDF

## Situação em 06/11/2026

A migração 84 foi autorizada pelo usuário, aplicada no Supabase Disb Gestão e
verificada: sete controles de privilégio/RLS verdadeiros e zero emissões de teste.
A migração 83 já estava aplicada. Nenhuma mensagem foi enviada pelo agente.

O modelo `comprovante_avaria_pdf`, `pt_BR`, ID `4700204463550408`, conta Disbecol
`940672352023940`, foi confirmado como **Ativo — Qualidade pendente**, categoria
**Utilidade**. A função `send-damage-receipt` foi publicada em produção após essa
confirmação, conforme autorização do usuário. Os próximos envios utilizam o PDF
com assinatura e código único. Nenhum teste real ou mensagem foi enviado pelo
agente; o fluxo de envio completo ainda depende da primeira utilização pelo usuário.

A versão web 1.7.67 inclui consulta por código e comparação do arquivo; a versão
web atual é 1.7.68. Os dois fontes canônicos abaixo foram publicados juntos pelo
editor do Supabase. Após recarregar o editor, seus hashes foram conferidos com os
arquivos locais e coincidiram. O resumo da função confirmou a implantação recente
e zero invocações desde a publicação. Fontes canônicos:

- `supabase/functions/send-damage-receipt/index.ts`: SHA-256 `a3a4e003ff6463ff8de2d99d2d60120dccc50c14a0833c4c90d6f65eb5a98a2f`.
- `supabase/functions/send-damage-receipt/receipt-pdf.mjs`: SHA-256 `944d03c843baeae8c8ea208a05ae7bf640227ea2aef60cbd7b622bd25c8597b4` (rodapé discreto, ajuste de 06/11/2026).
- `supabase/84_damage_receipt_verification.sql`: SHA-256 `91a6f00eb17adf33ed412d7fa52f5e642af2f46797005406756e2100bedb72b7`.

Os Secrets de token e identificador do telefone já existem. `WHATSAPP_TEMPLATE_NAME`
estava ausente, portanto o novo padrão usa `comprovante_avaria_pdf`. Não é preciso
ler ou alterar token. A mudança de PDF é no servidor: APK antigo também receberá
PDF após ativação. A nova busca/validação exige o frontend 1.7.67; atualizar a web
ou o APK conforme a plataforma usada.

## Documento enviado

Uma única mensagem de modelo reúne o documento e a apresentação com emojis:

> Olá, {{1}}! 👋
>
> Somos da equipe de logística da *Disbecol*. 🚚
>
> 📄 Segue em anexo o comprovante de avaria referente ao dia *{{2}}*.
>
> 🤖 Esta é uma mensagem automática. *Por favor, não responda.*
>
> Dúvidas? Central de Atendimento: (84) 9 9609-9264.

A saudação usa `damage_requests.created_at` em America/Sao_Paulo: bom dia antes
12h, boa tarde antes 18h, boa noite nos demais horários. A segunda variável usa
`occurrence_date`, DD/MM/AAAA. Nunca usar o horário do clique para a saudação.

O PDF é exatamente uma folha A4 com cliente, PDV, mapa, data, produtos, quantidade,
observação de reposição, assinatura que o cliente fez na avaria, código único e
central. Usa somente imagens do catálogo. Fotos de evidência, GPS, motivo e
pareceres internos permanecem excluídos. A assinatura é baixada do bucket privado
pelo usuário autenticado e só entra no PDF do cliente correspondente.

O código DGB aparece em maiúsculas no rodapé, imediatamente à esquerda de `1 / 1`,
na mesma fonte Helvetica de 7 pontos e cor discreta do aviso fiscal. Não há quadro,
título ou instrução de validação em destaque no corpo do documento. A consulta,
unicidade, registro imutável e comparação por SHA-256 permanecem iguais. A mudança
altera apenas o PDF gerado; o texto e o contrato do modelo aprovado não mudaram.

O layout adapta fonte entre 10 e 8 pontos e retira imagens opcionais na versão
compacta. Se todos os produtos não couberem com leitura adequada, retorna
`RECEIPT_LAYOUT_TOO_LARGE` antes de upload/envio. Nunca corta itens ou assinatura,
nem gera página adicional. Assinatura ausente/ilegível também bloqueia o envio.

## Registro e validação

`damage_receipts` é um registro separado dos envios, sem cascatas, preservando os
dados de emissão mesmo se a avaria original for apagada. Cada geração reserva um
UUID aleatório no banco e um código gerado a partir dele, no formato
`DGB-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`. Há unicidade no código e no send_id.
A reserva não é apresentada como emissão até existir hash e data de geração.

O servidor salva uma cópia imutável dos dados do PDF e o hash SHA-256 da assinatura.
Depois de gerar o arquivo, salva seu SHA-256 e data de geração ANTES de transmitir
mídia à Meta. Uma falha de persistência impede qualquer envio. Os dados e o hash
selado não podem ser substituídos; o servidor não tem DELETE nem UPDATE dos dados.
A consulta autenticada respeita unidade e permissões de Avarias; não é pública.

Em **Todas as avarias**, o campo Buscar aceita o código completo, com ou sem
hífens e sem distinguir maiúsculas. A busca consulta o banco, inclusive para avaria
fora dos 1000 registros recentes. O botão **Comprovantes emitidos** no detalhe
abre as emissões daquela avaria. **Validar comprovante** permite consultar o
código e selecionar o PDF recebido; o hash é calculado localmente, sem reenviar
arquivo ao servidor. Igualdade confirma arquivo idêntico; divergência NÃO confirma
autenticidade. Código sozinho não prova integridade, pois pode ser copiado.

A validação confirma a emissão, não aprovação nem reposição: conferir o fluxo da
avaria antes de atender a cobrança. PDFs antigos/textos não recebem certificação
retroativa. Um PDF alterado ou reexportado deixa de coincidir com o hash original.

## Ativação após aprovação

Procedimento concluído em 06/11/2026. A migração 84 não foi reaplicada, os Secrets
e as permissões não foram alterados. Evidências locais em
`tmp/meta-pdf-aprovado-20261106.jpg` e
`tmp/supabase-comprovante-pdf-ativado-20261106.jpg`.
O editor exibiu duas entradas de `receipt-pdf.mjs` após publicar; ambas apresentaram
o mesmo SHA-256 canônico. O arquivo principal também foi conferido após recarga.
O acompanhamento automático fica pausado após a ativação verificada.

O ajuste de rodapé de 06/11/2026 também foi publicado na mesma função, sem
invocá-la e sem alterar o modelo da Meta. Em nova aba do editor, as duas entradas
do gerador coincidiram com o SHA-256 atualizado acima. Evidência:
`tmp/supabase-rodape-discreto-publicado-20261106.jpg`. A amostra foi renderizada
novamente e confirmou uma folha A4, código em maiúsculas com 7 pontos na mesma
linha do aviso fiscal e a 12 pontos da paginação. Os 25 testes passaram novamente.

1. Conferir o modelo ativo/aprovado e categoria Utilidade na Meta.
2. Publicar os DOIS arquivos canônicos da função existente `send-damage-receipt`
   no projeto `jrsjbcdahqpcgcvzdtfb`. A migração 84 já está aplicada; não reaplicar.
3. Conferir o sucesso de Deploy updates; NÃO clicar Test, invocar função ou enviar
   mensagem. Nenhum teste real está autorizado nesta tarefa.
4. Atualizar este documento com o resultado, informar o usuário e pausar o
   acompanhamento `ativar-comprovante-pdf-ap-s-aprova-o-da-meta`.
5. Se rejeitado ou reclassificado, manter produção de texto e informar o motivo.

O modelo possui cabeçalho DOCUMENT e duas variáveis no corpo. `template-pdf.json`
registra o contrato; o handle de amostra foi enviado pela interface da Meta.
O PDF de amostra é fictício, incluindo assinatura e identificador: não existe
emissão correspondente no banco de produção.

## Verificações

25 testes passaram (arquivos damage-receipt, damage-receipt-pdf,
damage-receipt-database, damage-receipt-verification e damage-receipt-search).
Cobrem RLS/unidade, privilégios, imutabilidade, registro antes do envio, duplicidade,
consentimento, assinatura obrigatória, folha única sem truncamento, hash alterado,
busca de registro antigo e resposta atrasada após troca de unidade.

A tela de validação foi testada no navegador com base fictícia e reconheceu o
arquivo original. A amostra final foi renderizada com Poppler e inspecionada,
confirmando uma página, assinatura, código, legibilidade e margens.

```powershell
node --test tests/damage-receipt.test.mjs tests/damage-receipt-pdf.test.mjs tests/damage-receipt-database.test.mjs tests/damage-receipt-verification.test.mjs tests/damage-receipt-search.test.mjs
node scripts/create-receipt-preview.mjs
```

O histórico de tentativas e a trava de duplicidade permanecem em
`damage_receipt_sends`: falhas anteriores à chamada de mensagem ficam rejeitadas;
resposta incerta após iniciar envio fica UNKNOWN para bloquear duplicidade.
Não há webhook de confirmação de entrega nesta mudança.
