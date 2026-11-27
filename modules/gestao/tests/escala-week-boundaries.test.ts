import {describe,it,expect,vi,afterEach} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {ALGORITHM,generateMonth,officialHolidays,plusDays,validatePlan,weekday} from '../src/escala/engine';
import {prepareEscalaDraft} from '../src/escala/draft-policy';
import {comparisonWeeks} from '../src/escala/comparison-weeks';
import {createEscalaService} from '../src/escala/service';
import type {MonthPlan} from '../src/escala/model';

function fixture(){const state=escalaFixture();state.memberships.slice(0,6).forEach(m=>{m.origin='MANUAL';m.draw_month=null;});state.holidays=[...officialHolidays(2026),...officialHolidays(2027)].map((h,i)=>({...h,id:'holiday-'+i,revision:1}));return state;}
afterEach(()=>vi.unstubAllGlobals());
describe('domingos e duas folgas na virada dos meses',()=>{
 it('mantém todos os domingos de folga e pelo menos duas folgas por pessoa nas semanas completas de novembro a janeiro',()=>{
  for(const seed of ['A','B','C']){
   const state=fixture(),plans:MonthPlan[]=[];
   for(const month of ['2026-11-01','2026-12-01','2027-01-01']){const plan=generateMonth(state,month,seed+month).plan;plans.push(plan);state.rotation_history=plans.flatMap(p=>p.days);}
   const days=plans.flatMap(p=>p.days);
   for(const day of days.filter(d=>weekday(d.date)===0))expect(day.duties.every(d=>d.mode==='REST')).toBe(true);
   for(const p of state.staff)for(let start='2026-11-02';start<='2027-01-25';start=plusDays(start,7)){
    const week=days.filter(d=>d.date>=start&&d.date<=plusDays(start,6));expect(week).toHaveLength(7);expect(week.filter(d=>d.duties.some(a=>a.mode==='REST'&&a.members.some(m=>m.id===p.id))).length).toBeGreaterThanOrEqual(2);
   }
  }
 });
 it('calcula o sábado pelo histórico da pessoa, mesmo quando o grupo muda na virada do mês',()=>{
  const state=fixture();state.holidays=[];const april=generateMonth(state,'2027-04-01','april').plan,lastWeek=april.days.filter(d=>d.date>='2027-04-26'),offTeam=state.teams.slice(2).find(t=>lastWeek.some(d=>d.duties.some(a=>a.team_id===t.id&&a.mode==='REST')))!,workedTeam=state.teams.slice(2).find(t=>lastWeek.every(d=>d.duties.some(a=>a.team_id===t.id&&a.mode==='ROUTE')))!;
  expect(offTeam).toBeTruthy();expect(workedTeam).toBeTruthy();state.rotation_history=april.days;
  for(const membership of state.memberships)if(membership.team_id===offTeam.id)membership.team_id=workedTeam.id;else if(membership.team_id===workedTeam.id)membership.team_id=offTeam.id;
  const may=generateMonth(state,'2027-05-01','may').plan;
  expect(may.days[0].duties.find(d=>d.team_id===offTeam.id)?.mode).toBe('REST');
  expect(may.days[0].duties.find(d=>d.team_id===workedTeam.id)?.mode).toBe('ROUTE');
  expect(may.days[1].duties.every(d=>d.mode==='REST')).toBe(true);
 });
 it('atualiza rascunho antigo e domingo manual sem apagar notas, bloqueios ou trabalho já realizado',()=>{
  const state=fixture(),old=generateMonth(state,'2026-11-01','old').plan;old.algorithm_version='old';old.days[7].manual=true;old.days[7].notes='Ajuste preservado';old.days[7].duties[3].mode='ROUTE';old.days[14].locked=true;old.days[14].duties[3].mode='ROUTE';old.days[21].duties[3].completed=true;old.days[21].duties[3].mode='ROUTE';const before=structuredClone(old),prepared=prepareEscalaDraft(state,old);
  expect(prepared.updated).toBe(true);expect(prepared.plan?.algorithm_version).toBe(ALGORITHM);expect(prepared.plan?.days[7].duties[3].mode).toBe('REST');expect(prepared.plan?.days[7].notes).toBe('Ajuste preservado');expect(prepared.plan?.days[14]).toEqual(old.days[14]);expect(prepared.plan?.days[21].duties[3]).toEqual(old.days[21].duties[3]);expect(old).toEqual(before);expect(validatePlan(state,prepared.plan!).some(i=>i.code==='SUNDAY'&&i.date==='2026-11-15')).toBe(true);
  old.status='APPROVED';expect(prepareEscalaDraft(state,old)).toEqual({plan:old,updated:false});
 });
 it('aponta uma semana completa com uma só folga e não confunde semana parcial com violação',()=>{
  const state=fixture(),plan=generateMonth(state,'2027-02-01','week').plan;
  for(const day of plan.days.slice(0,6))day.duties.find(d=>d.team_id==='team-3')!.mode='ROUTE';
  expect(validatePlan(state,plan).filter(i=>i.code==='PERSON_WEEKLY_REST')).toHaveLength(3);
  const person=state.staff.find(p=>p.id==='team-3-person-0')!,weeks=comparisonWeeks({state,plan},person.id);
  expect(weeks[0]).toMatchObject({off:1,missing:0,invalid:true,sundayWork:false});
  const november=generateMonth(state,'2026-11-01','nov').plan,decemberState={...state,rotation_history:november.days},december=generateMonth(decemberState,'2026-12-01','dec').plan;
  const compared=comparisonWeeks({state:decemberState,plan:december},person.id,[{state,plan:november}]);
  expect(compared[0].missing).toBe(0);expect(compared[0].dates[0].date).toBe('2026-11-30');expect(compared[0].dates[6].date).toBe('2026-12-06');expect(compared.at(-1)).toMatchObject({missing:3,invalid:false});
 });
 it('usa o rascunho local do mês anterior no cálculo, sem gravar ou sobrescrever uma escala aprovada',async()=>{
  const state=fixture(),saved={...generateMonth(state,'2026-11-01','saved').plan,id:'saved',revision:4},local=structuredClone(saved);local.days[29].manual=true;local.days[29].duties[2].mode='REST';let writes=0;const memory=JSON.stringify(local);vi.stubGlobal('localStorage',{getItem:()=>memory,setItem:()=>writes++});
  const adapter={context:()=>({user:{id:'user'},unit:'Matriz Caicó',units:[],profile:{name:'Gestor',role:'ADMIN'},client:{rpc:async(_name:string,args:Record<string,unknown>)=>({data:{...state,plan:args.p_month==='2026-11-01'?saved:null},error:null})}}),hasPermission:()=>true,toast:()=>{},openView:()=>{},download:()=>{}};
  const loaded=await createEscalaService(adapter).load('2026-12-01');expect(loaded.rotation_history?.find(d=>d.date==='2026-11-30')?.duties[2].mode).toBe('REST');expect(writes).toBe(0);
  saved.status='APPROVED';const approved=await createEscalaService(adapter).load('2026-12-01');expect(approved.rotation_history?.find(d=>d.date==='2026-11-30')?.duties[2].mode).toBe(saved.days[29].duties[2].mode);expect(writes).toBe(0);
 });
});
