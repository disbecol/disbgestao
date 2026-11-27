import type {CycleCell,PersonCycle,WarehouseConfig,WarehousePerson} from './model.ts';
import {normalized} from './model.ts';
const rest=():CycleCell=>({mode:'REST',shift_id:null});
const work=(shift_id:string,notes=''):CycleCell=>({mode:'WORK',shift_id,notes});
function week(shift:string,off:number,saturday:string|null,overrides:Record<number,string>={}):CycleCell[]{return Array.from({length:7},(_,i)=>i===6||i===off-1?rest():i===5?saturday?work(saturday):rest():work(overrides[i+1]||shift));}
export function referenceCycle(name:string):PersonCycle|null{
 const key=normalized(name);
 if(key.startsWith('roberto '))return {base_shift:'CHECK_AM',weeks:[week('CHECK_AM',1,'CHECK_AM'),week('CHECK_AM',6,null,{5:'SPLIT'}),week('CHECK_AM',6,null,{5:'SPLIT'}),week('CHECK_AM',6,null)]};
 if(key.startsWith('iago '))return {base_shift:'CHECK_PM',weeks:[week('CHECK_PM',6,null),week('CHECK_PM',5,'CHECK_AM'),week('CHECK_PM',6,null,{5:'NIGHT'}),week('CHECK_PM',6,null,{1:'NIGHT'})]};
 if(key.startsWith('severino '))return {base_shift:'NIGHT',weeks:[week('NIGHT',6,null),week('NIGHT',6,null),week('NIGHT',5,'CHECK_AM'),week('NIGHT',1,'CHECK_AM')]};
 if(key.startsWith('alysson '))return {base_shift:'FORK_AM',weeks:[week('FORK_AM',6,null),week('FORK_AM',6,null),week('FORK_AM',6,null)]};
 if(key.includes('dantas'))return {base_shift:'CHECK_PM',weeks:[week('CHECK_PM',5,'FORK_AM'),week('CHECK_PM',6,null),week('CHECK_PM',6,null)]};
 if(key.includes('samuel'))return {base_shift:'NIGHT',weeks:[week('NIGHT',6,null,{5:'CHECK_PM'}),week('NIGHT',5,'FORK_AM'),week('NIGHT',6,null)]};
 if(key.startsWith('genilson '))return {base_shift:'NIGHT',weeks:[week('NIGHT',6,null),week('NIGHT',6,null),week('NIGHT',5,'FORK_AM')]};
 return null;
}
export function defaultWarehouseConfig(staff:WarehousePerson[]):WarehouseConfig{
 return {version:1,anchor_date:null,shifts:[{id:'CHECK_AM',name:'1º turno · conferência',segments:[{start:'06:00',end:'16:00'}],break_minutes:60},{id:'FORK_AM',name:'1º turno · empilhadeira',segments:[{start:'07:00',end:'17:00'}],break_minutes:60},{id:'CHECK_PM',name:'2º turno',segments:[{start:'14:00',end:'23:00'}],break_minutes:60},{id:'NIGHT',name:'3º turno · noturno',segments:[{start:'19:00',end:'04:00'}],break_minutes:60},{id:'SPLIT',name:'Cobertura · manhã e tarde',segments:[{start:'06:00',end:'09:00'},{start:'14:00',end:'19:00'}],break_minutes:0}],people:Object.fromEntries(staff.filter(p=>p.role!=='HELPER').map(p=>[p.id,referenceCycle(p.name)||{base_shift:p.role==='CHECKER'?'CHECK_AM':'FORK_AM',weeks:[week(p.role==='CHECKER'?'CHECK_AM':'FORK_AM',6,null)]}])),helper_shift:'NIGHT',qlp:{weekdays:{},dates:{}},rules:{weekly_minutes:2400,daily_minutes:480,min_rest_minutes:660,break_minutes:60,compensation:false,reference:''},notes:'Modelo baseado na referência: conferentes em ciclo de 4 semanas; empilhadores em ciclo de 3 semanas. Sextas de cobertura: Roberto 06h–09h e 14h–19h. Na terceira semana, Iago assume às 19h conforme a observação da imagem. Turnos e intervalos devem ser conferidos pela gestão. A data de início ainda será definida.'};
}
