import fs from 'node:fs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node scripts/build-product-ref-migration.mjs source.csv output.sql');
const lines = fs.readFileSync(source, 'latin1').trim().split(/\r?\n/).map(line => line.split(';'));
if (lines[0].length !== 5 || lines[0][0] !== 'code promax') throw new Error('Unexpected CSV columns');
const rows = lines.slice(1);
const codes = new Set(), refs = [new Set(), new Set()];
if (rows.length !== 192) throw new Error(`Expected 192 products, found ${rows.length}`);
const sqlString = value => value === '#N/D' || !value ? 'null' : `'${value.replaceAll("'", "''")}'`;
const values = rows.map(([code, _name, matrix, branch, pallet], index) => {
  if (!/^\d+$/.test(code) || !/^\d+$/.test(pallet) || codes.has(code)) throw new Error(`Invalid product at row ${index + 2}`);
  codes.add(code);
  for (const [i, ref] of [matrix, branch].entries()) {
    if (ref !== '#N/D' && ref) {
      if (!/^[A-Za-z0-9]+$/.test(ref) || refs[i].has(ref)) throw new Error(`Invalid or duplicate reference ${ref} at row ${index + 2}`);
      refs[i].add(ref);
    }
  }
  return `  (${sqlString(code)},${sqlString(matrix)},${sqlString(branch)},${Number(pallet) || 'null'})`;
});
const sql = `-- Fonte: ${source.replaceAll('\\', '/')}. Atualiza a tabela unica de produtos.
-- #N/D vira NULL; os codigos ausentes poderao ser cadastrados em Configuracoes > Produtos.
begin;
create temporary table pull_product_refs_import(
  code text primary key,
  matrix_ref text,
  branch_ref text,
  units_per_pallet integer check(units_per_pallet > 0)
) on commit drop;
insert into pull_product_refs_import(code,matrix_ref,branch_ref,units_per_pallet) values
${values.join(',\n')};
do $$
declare v_updated integer;
begin
  if exists(select 1 from pull_product_refs_import i left join public.products p on p.code=i.code where p.code is null) then
    raise exception 'PRODUTO_PROMAX_AUSENTE_NA_BASE';
  end if;
  update public.products p set nf_reference_code=i.matrix_ref,
    nf_reference_code_filial=i.branch_ref,
    commercial_units_per_pallet=i.units_per_pallet,
    updated_at=now()
  from pull_product_refs_import i where p.code=i.code;
  get diagnostics v_updated=row_count;
  if v_updated<>${rows.length} then raise exception 'PRODUTOS_ATUALIZADOS_INCORRETOS: %',v_updated; end if;
end $$;
commit;
`;
fs.writeFileSync(destination, sql, 'utf8');
console.log(`Generated ${destination}: ${rows.length} products, ${refs[0].size} matrix references, ${refs[1].size} branch references.`);
