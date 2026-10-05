import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const start=source.indexOf('function refugoRemaining(');
const end=source.indexOf('async function refugoFetchAll(',start);
assert.ok(start>=0&&end>start);
const context={REFUGO_MAP_FIELDS:{g300:'300ml'},fmtDate:value=>value,esc:value=>String(value)};
vm.runInNewContext(source.slice(start,end),context);

test('saldo do mapa soma aferições concluídas da mesma coluna, mesmo com tipos distintos',()=>{
  const session={map_limits:{g300:920,g600_green:240}};
  const items=[
    {status:'COMPLETED',map_field:'g300',quantity_checked:300},
    {status:'COMPLETED',map_field:'g300',quantity_checked:120},
    {status:'RUNNING',map_field:'g300',quantity_checked:80},
    {status:'COMPLETED',map_field:'g600_green',quantity_checked:50}
  ];
  assert.equal(context.refugoRemaining('g300',session,items),500);
  assert.equal(context.refugoRemaining('g600_green',session,items),190);
});

test('saldo zero impede novo lançamento e mapa sem base não tem limite disponível',()=>{
  assert.equal(context.refugoRemaining('g300',{map_limits:{g300:40}},[
    {status:'COMPLETED',map_field:'g300',quantity_checked:40}
  ]),0);
  assert.equal(context.refugoRemaining('g300',{map_limits:null},[]),null);
});
