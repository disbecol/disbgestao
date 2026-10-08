param(
  [Parameter(Mandatory=$true)][string]$CsvPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $CsvPath -Delimiter ';' -Encoding Latin1
function SqlText([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$values = foreach($row in $rows) {
  $code = ([string]$row.'code promax').Trim()
  $name = ([string]$row.name).Trim()
  $reference = ([string]$row.'code referencia NF').Trim()
  $capacity = ([string]$row.'compõe um palete').Trim()
  if(!$code -or !$name -or $capacity -notmatch '^\d+$') { throw "Linha de produto inválida: $code" }
  if($capacity -eq '0') { $capacity = 'null' }
  if($reference -eq '#N/D' -or !$reference) { $refSql = 'null' } else { $refSql = SqlText $reference }
  '  (' + (SqlText $code) + ',' + (SqlText $name) + ',' + $refSql + ',' + $capacity + ')'
}
$sql = @(
  '-- Catálogo entregue pelo usuário: código Promax, referência NF e unidades comerciais por palete.'
  '-- Acrescenta metadados na tabela existente public.products; não cria outro cadastro.'
  'begin;'
  'insert into public.products(code,name,nf_reference_code,commercial_units_per_pallet) values'
  ($values -join ",`n") + "`n" + 'on conflict(code) do update set'
  '  nf_reference_code=coalesce(excluded.nf_reference_code,public.products.nf_reference_code),'
  '  commercial_units_per_pallet=excluded.commercial_units_per_pallet,'
  '  updated_at=now();'
  'commit;'
)
Set-Content -LiteralPath $OutputPath -Value $sql -Encoding utf8
Write-Output "Gerados $($rows.Count) produtos."
