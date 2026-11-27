import type {WarehousePerson,WarehouseState} from '../src/warehouse/model';
import {defaultWarehouseConfig} from '../src/warehouse/templates.ts';
export function warehouseFixture():WarehouseState{
 const groups=[['CHECKER','Conferente',['Roberto Teste','Iago Teste','Severino Teste']],['FORKLIFT','Operador de empilhadeira',['Alysson Teste','Dantas Teste','Samuel Teste','Genilson Teste']],['HELPER','Ajudante de armazém',Array.from({length:6},(_,i)=>'Ajudante '+(i+1)+' Teste')]] as const;
 const staff:WarehousePerson[]=groups.flatMap(([role,job,names],g)=>names.map((name,i)=>({id:'00000000-0000-4000-8000-'+String(g*10+i+1).padStart(12,'0'),name,job,role,active:true,status:'ACTIVE',vacation_start:null,vacation_end:null}))),config=defaultWarehouseConfig(staff);config.anchor_date='2026-12-07';return {staff,config,config_revision:1,holidays:[],plan:null,history:[],adjacent:[],audit:[]};
}
