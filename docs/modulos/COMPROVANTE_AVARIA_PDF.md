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
web atual é 1.7.70. Os dois fontes canônicos abaixo foram publicados juntos pelo
editor do Supabase. Após recarregar o editor, seus hashes foram conferidos com os
arquivos locais e coincidiram. O resumo da função confirmou a implantação recente
e zero invocações desde a publicação. Fontes canônicos:

- `supabase/functions/send-damage-receipt/index.ts`: SHA-256 `a3a4e003ff6463ff8de2d99d2d60120dccc50c14a0833c4c90d6f65eb5a98a2f`.
- `supabase/functions/send-damage-receipt/receipt-pdf.mjs`: SHA-256 `542d74deb174b0e2e982984dfce3642af336dca8b691fb37931821a14c91cf3e` (rodapé discreto e orientação de contato sem telefone, ajuste de 06/11/2026).
- `supabase/84_damage_receipt_verification.sql`: SHA-256 `91a6f00eb17adf33ed412d7fa52f5e642af2f46797005406756e2100bedb72b7`.

Os Secrets de token e identificador do telefone já existem. `WHATSAPP_TEMPLATE_NAME`
estava ausente, portanto o novo padrão usa `comprovante_avaria_pdf`. Não é preciso
ler ou alterar token. A mudança de PDF é no servidor: APK antigo também receberá
PDF após ativação. A nova busca/validação exige o frontend 1.7.67; atualizar a web
ou o APK conforme a plataforma usada.

## Atualização 1.7.70 — descrição curta e central sem telefone

A migração 85 foi aplicada em produção e oito verificações retornaram verdadeiro.
Os campos de evidência aceitam descrições curtas como RG e CNH, sem mínimo de
caracteres além do preenchimento obrigatório. Mantêm os limites máximos, nome,
consentimento, maioridade, país, autoria e controles de acesso anteriores.
Nenhum contato foi modificado para testar a aplicação.

O gerador do PDF foi publicado e os três arquivos exibidos no editor recarregado
(index e as duas entradas do helper) coincidiram com os fontes canônicos. O PDF
continua em uma folha com assinatura e código; o telefone foi retirado. Os PDFs
já emitidos mantêm seus dados e hashes imutáveis. O texto do envio manual também
usa a orientação sem telefone e o aviso automático ao final.

O corpo novo do modelo `comprovante_avaria_pdf` foi enviado para análise em
06/11/2026, mantendo Utilidade, pt_BR, ID e duas variáveis. O último estado
observado foi **Em análise**. A nova redação depende da aprovação da Meta.
Não foram enviados testes a clientes, lidos/alterados tokens nem reativado o
agendamento de acompanhamento.

28 testes passaram, incluindo RG/CNH, campo em branco, consentimentos, autoria,
negação a anônimos, histórico imutável e folha única. A amostra foi renderizada
e inspecionada sem telefone. Evidências: `tmp/meta-texto-sem-telefone-em-analise.png`,
`tmp/supabase-validacao-documento-curto.png`.

## Documento enviado

Uma única mensagem de modelo reúne o documento e a apresentação com emojis:

> Olá, {{1}}! 👋
>
> Somos da equipe de logística da *Disbecol*. 🚚
>
> 📄 Segue em anexo o comprovante de avaria referente ao dia *{{2}}*.
>
> Em caso de dúvidas, entre em contato com nossa central de atendimento.
>
> 🤖 Essa é uma mensagem automática, *por favor não responder.*

A saudação usa `damage_requests.created_at` em America/Sao_Paulo: bom dia antes
12h, boa tarde antes 18h, boa noite nos demais horários. A segunda variável usa
`occurrence_date`, DD/MM/AAAA. Nunca usar o horário do clique para a saudação.

O PDF é exatamente uma folha A4 com cliente, PDV, mapa, data, produtos, quantidade,
observação de reposição, assinatura que o cliente fez na avaria, código único e
orientação de contato com a central, sem número de telefone. Usa somente imagens do catálogo. Fotos de evidência, GPS, motivo e
pareceres internos permanecem excluídos. A assinatura é baixada do bucket privado
pelo usuário autenticado e só entra no PDF do cliente correspondente.

O código DGB aparece em maiúsculas no rodapé, imediatamente à esquerda de `1 / 1`,
na mesma fonte Helvetica de 7 pontos e cor discreta do aviso fiscal. Não há quadro,
título ou instrução de validação em destaque no corpo do documento. A consulta,
unicidade, registro imutável e comparação por SHA-256 permanecem iguais. A mudança
do rodapé alterou apenas o PDF gerado. A revisão seguinte retirou o telefone do
texto do modelo, mantendo o cabeçalho DOCUMENT e as duas variáveis originais.

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
5. Se rejeitado ou reclassificado, não forçar envio nem usar alternativa de texto; informar o motivo.

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


## Reenvio confirmado e aceite com envio — 10/11/2026

Versão 1.7.73: cada registro em Minhas avarias possui a ação Reenviar comprovante
de avaria. O cadastro do cliente é resolvido por código, nome e cidade, mantendo
a autoria e a unidade. Abrir o comprovante não dispara mensagens.

O aceite usa o botão Aceitar termos e enviar comprovante. A ação registra o
consentimento, relê a elegibilidade do contato e solicita o envio autenticado.
Se o aceite for salvo e o envio falhar, o contato continua autorizado e a falha
é apresentada separadamente, permitindo retomar o envio.

Um contato com envio já aceito exige uma confirmação de nova mensagem/cobrança.
O navegador mantém o mesmo operation_id ao repetir a mesma tentativa após uma
resposta perdida. O servidor reserva atomicamente a operação; PROCESSING/UNKNOWN
continuam bloqueando concorrência. Um reenvio deliberado cria outro registro
com resend_of, outro PDF e outro DGB, preservando todos os arquivos, hashes e
aceites anteriores. Clientes antigos continuam protegidos contra duplicidade.

A migração 86 foi aplicada ao projeto jrsjbcdahqpcgcvzdtfb antes da publicação
da função. Oito consultas de verificação retornaram true, incluindo ausência
de execução direta por anon/authenticated e manutenção do RLS. A função foi
recarregada no editor e o fonte publicado coincidiu com o arquivo canônico.

SHA-256 dos fontes publicados:

- index.ts: eeeeb9991fb97344401a889f26cef54c7cf41f61948cc49881c9468ac5b9e7a7
- receipt-pdf.mjs (inalterado): 542d74deb174b0e2e982984dfce3642af336dca8b691fb37931821a14c91cf3e
- migração 86: 36d70fe04ba78f0b2022d9c89429dee5330f97ced87d5be84b5c7553b16f3f4c

67 testes passaram, incluindo PostgreSQL/PGlite real para a reserva, histórico,
replays, concorrência, consentimento, troca de conta/unidade e capturas tardias.
A interface foi conferida com dados fictícios e rede simulada. Nenhuma mensagem
real ou invocação da função foi executada pelo agente nesta atualização.
Tokens, modelo da Meta e permissões de acesso aos dados não foram alterados.

Evidências locais: tmp/receipt-resend-migration86-checks.png,
tmp/receipt-resend-service-verified.png, tmp/minhas-avarias-reenviar.png e
tmp/aceitar-termos-e-enviar.png.
