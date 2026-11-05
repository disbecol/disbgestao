# Comprovante de avaria em PDF

## Situação em 05/11/2026

A migração 84 foi autorizada pelo usuário, aplicada no Supabase Disb Gestão e
verificada: sete controles de privilégio/RLS verdadeiros e zero emissões de teste.
A migração 83 já estava aplicada. Nenhuma mensagem foi enviada pelo agente.

O modelo `comprovante_avaria_pdf`, `pt_BR`, ID `4700204463550408`, conta Disbecol
`940672352023940`, continua **Em análise**, categoria **Utilidade**. O envio atual
permanece no modelo antigo de texto. NÃO publicar a função enquanto o modelo
estiver pendente/rejeitado ou em categoria diferente de Utilidade. O usuário já
aprovou ativar após aprovação, sem envio de teste. Não repetir essa autorização.

A versão web 1.7.67 inclui consulta por código e comparação do arquivo. O gerador
com assinatura, identificador e uma folha está preparado localmente e no rascunho
da função, sem clicar em Deploy updates. Fontes canônicos:

- `supabase/functions/send-damage-receipt/index.ts`: SHA-256 `a3a4e003ff6463ff8de2d99d2d60120dccc50c14a0833c4c90d6f65eb5a98a2f`.
- `supabase/functions/send-damage-receipt/receipt-pdf.mjs`: SHA-256 `8cee2ef25b3f7e77b0b44976eee2f8564eaec83b39f270d9d885f100712cf72d`.
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
