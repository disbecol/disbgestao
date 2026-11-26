import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth,moveRest,validatePlan,weekday} from '../src/escala/engine';
function fixture(){const s=escalaFixture();for(const m of s.memberships.filter(m=>s.teams.slice(0,2).some(t=>t.id===m.team_id))){m.origin='MANUAL';m.draw_month=null;}return s;}

describe('Equipes preservadas com jornada fixa',()=>{
 it('mantém as duas preservadas em rota de segunda a sexta e de folga no fim de semana, com 9 rotas úteis e 5 aos sábados',()=>{
  const s=fixture(),before=structuredClone(s),{plan,issues}=generateMonth(s,'2027-02-01','fixed-week');expect(issues).toEqual([]);
  for(const day of plan.days){const dow=weekday(day.date);for(const team of s.teams.slice(0,2))expect(day.duties.find(a=>a.team_id===team.id)!.mode).toBe(dow===0||dow===6?'REST':'ROUTE');expect(day.duties.filter(a=>a.mode==='ROUTE')).toHaveLength(dow===0?0:dow===6?5:9);}
  expect(s).toEqual(before);expect(generateMonth(s,'2027-02-01','fixed-week').plan).toEqual(plan);
 });
 it('sorteia o revezamento apenas entre as outras equipes, inclusive no mês seguinte',()=>{
  const s=fixture();s.history=generateMonth(s,'2027-02-01','first').plan.days;const next=generateMonth(s,'2027-03-01','second').plan;
  for(const day of next.days)for(const team of s.teams.slice(0,2))expect(day.duties.find(a=>a.team_id===team.id)!.mode).toBe([0,6].includes(weekday(day.date))?'REST':'ROUTE');
 });
 it('estar fora do sorteio não tira a preservada das rotas úteis',()=>{
  const s=fixture();s.teams[0].draw_enabled=false;const {plan,issues}=generateMonth(s,'2027-02-01','not-in-draw');expect(issues).toEqual([]);for(const day of plan.days)expect(day.duties[0].mode).toBe([0,6].includes(weekday(day.date))?'REST':'ROUTE');
 });
 it('respeita feriados e afastamentos, e mantém o sábado livre mesmo quando houver operação especial',()=>{
  const s=fixture();s.holidays.push({id:'holiday',date:'2027-02-08',name:'Feriado fictício',kind:'MUNICIPAL',source_url:'',automatic:false,enabled:true,operates:false,previous_saturday:true,confirmed:true,revision:1});
  s.unavailable.push({id:'leave',team_id:s.teams[0].id,staff_id:null,starts_on:'2027-02-09',ends_on:'2027-02-09',reason:'Ausência',revision:1});const {plan}=generateMonth(s,'2027-02-01','holiday');expect(plan.days.find(d=>d.date==='2027-02-08')!.duties[0].mode).toBe('REST');expect(plan.days.find(d=>d.date==='2027-02-09')!.duties[0].mode).toBe('UNAVAILABLE');expect(plan.days.find(d=>d.date==='2027-02-06')!.duties[0].mode).toBe('REST');
 });
 it('corrige folgas úteis antigas das preservadas ao gerar novamente sem sobrescrever rotas realizadas nem dias bloqueados',()=>{
  const s=fixture();s.plan=generateMonth(s,'2027-02-01','old').plan;const manual=s.plan.days[0];manual.manual=true;manual.duties[0].mode='REST';const completed=s.plan.days.find(d=>weekday(d.date)===6)!;completed.duties[0].mode='ROUTE';completed.duties[0].completed=true;const record=structuredClone(completed.duties[0]);const locked=s.plan.days[10];locked.locked=true;const frozen=structuredClone(locked);
  const next=generateMonth(s,'2027-02-01','new').plan;expect(next.days[0].duties[0].mode).toBe('ROUTE');expect(next.days.find(d=>d.date===completed.date)!.duties[0]).toEqual(record);expect(next.days[10]).toEqual(frozen);
 });
 it('não oferece mudança da folga fixa nem permite trocar uma equipe em revezamento com a preservada',()=>{
  const s=fixture(),plan=generateMonth(s,'2027-02-01','move').plan,from=plan.days.find(d=>weekday(d.date)>0&&weekday(d.date)<6&&d.duties.some(a=>a.mode==='REST'))!,rotating=from.duties.find(a=>a.mode==='REST')!;
  expect(()=>moveRest(s,plan,s.teams[0].id,'2027-02-06','2027-02-08')).toThrow(/preservadas/);expect(()=>moveRest(s,plan,rotating.team_id,from.date,'2027-02-06',s.teams[0].id)).toThrow(/preservadas/);
  const bad=structuredClone(plan);bad.days[0].duties[0].mode='REST';expect(validatePlan(s,bad).some(i=>i.code==='FIXED_TEAM_SCHEDULE')).toBe(true);
 });
 it('reorganiza as equipes abertas de um dia já iniciado sem alterar a rota confirmada nem ultrapassar nove rotas',()=>{
  const s=fixture(),previous=generateMonth(escalaFixture(),'2027-02-01','previous').plan,day=previous.days[0];day.duties.forEach(a=>{a.mode=a.team_id===s.teams[0].id?'REST':'ROUTE';a.truck_id=null;});let n=0;for(const a of day.duties)if(a.mode==='ROUTE')a.truck_id=s.trucks[n++].id;
  const recorded=day.duties.find(a=>a.team_id===s.teams[2].id)!;recorded.completed=true;const snapshot=structuredClone(recorded);s.plan=previous;
  const {plan,issues}=generateMonth(s,'2027-02-01','new');expect(plan.days[0].duties.filter(a=>a.mode==='ROUTE')).toHaveLength(9);expect(plan.days[0].duties[0].mode).toBe('ROUTE');expect(plan.days[0].duties.find(a=>a.team_id===snapshot.team_id)).toEqual(snapshot);expect(issues.some(i=>i.code==='TRUCK'||i.code==='DUPLICATE_TRUCK'||i.code==='FIXED_TEAM_SCHEDULE')).toBe(false);
 });
});
