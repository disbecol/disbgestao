import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {available,generateMonth,legalWeeklyMinutes,monthDates,moveRest,officialHolidays,previousSaturday,specialSaturday,statistics,validatePlan,weekday} from '../src/escala/engine';
describe('Escala 5x2 operacional',()=>{
 it('programa nove equipes nos dias úteis, cinco aos sábados e domingo de descanso, mantendo a equipe indivisível',()=>{
  const state=escalaFixture(),{plan,issues}=generateMonth(state,'2027-02-01','reproducible');expect(issues).toEqual([]);
  for(const day of plan.days){expect(day.duties).toHaveLength(10);expect(day.duties.filter(d=>d.mode==='ROUTE')).toHaveLength(weekday(day.date)===0?0:weekday(day.date)===6?5:9);expect(day.duties.every(d=>d.members.length===3)).toBe(true);}
  for(const row of statistics(state,plan.days)){expect(row.worked).toBe(20);expect(row.total).toBe(8);}
  expect(generateMonth(state,'2027-02-01','reproducible').plan.days).toEqual(plan.days);
 });
 it('repete o dia útil dentro do mês e alterna os grupos de sábado conforme o histórico anterior',()=>{
  const state=escalaFixture(),first=generateMonth(state,'2027-02-01','first').plan;state.history=first.days;const next=generateMonth(state,'2027-03-01','second').plan;
  const weekdayRest=(plan:typeof first)=>new Set(plan.days.filter(d=>weekday(d.date)>=1&&weekday(d.date)<=5).flatMap(d=>d.duties.filter(x=>x.mode==='REST').map(x=>x.team_id)));
  const before=weekdayRest(first),after=weekdayRest(next);expect(before.size).toBe(5);expect(after.size).toBe(5);expect([...before].filter(id=>after.has(id))).toEqual([]);
  for(const id of before){const dates=first.days.filter(d=>weekday(d.date)>0&&weekday(d.date)<6&&d.duties.some(x=>x.team_id===id&&x.mode==='REST'));expect(new Set(dates.map(d=>weekday(d.date))).size).toBe(1);}
 });
 it('preserva dias bloqueados e alterações manuais ao repetir o sorteio e não altera escala aprovada',()=>{
  const state=escalaFixture();state.plan=generateMonth(state,'2027-02-01','one').plan;state.plan.days[0].locked=true;state.plan.days[2].manual=true;
  const next=generateMonth(state,'2027-02-01','two').plan;expect(next.days[0]).toEqual(state.plan.days[0]);expect(next.days[2]).toEqual(state.plan.days[2]);state.plan.status='APPROVED';expect(()=>generateMonth(state,'2027-02-01','three')).toThrow(/Desbloqueie/);
 });
 it('considera férias e indisponibilidades de período sem apagar o histórico',()=>{
  const state=escalaFixture(),person=state.staff[0];person.status='VACATION';person.vacation_start='2027-02-10';person.vacation_end='2027-02-12';
  expect(available(state,state.teams[0],'2027-02-09')).toBe(true);expect(available(state,state.teams[0],'2027-02-10')).toBe(false);expect(available(state,state.teams[0],'2027-02-13')).toBe(true);
  state.unavailable.push({id:'period',team_id:state.teams[1].id,staff_id:null,starts_on:'2027-02-03',ends_on:'2027-02-04',reason:'Licença',revision:1});const result=generateMonth(state,'2027-02-01','vacation');expect(result.plan.days.find(d=>d.date==='2027-02-03')?.duties.find(d=>d.team_id===state.teams[1].id)?.mode).toBe('UNAVAILABLE');
 });
 it('valida a composição sem exigir cadastro de caminhões',()=>{
  const state=escalaFixture();state.trucks[0].status='MAINTENANCE';state.memberships=state.memberships.filter(m=>m.staff_id!==state.staff[0].id);const result=generateMonth(state,'2027-02-01','shortage');expect(result.issues.some(i=>i.code==='TRUCK')).toBe(false);expect(result.issues.some(i=>i.code==='DRIVER')).toBe(true);
 });
 it('reconhece feriados por lei, trata a sexta-feira santa como local e identifica o sábado anterior inclusive em outro mês',()=>{
  const holidays=officialHolidays(2027);expect(holidays.filter(h=>h.kind==='NATIONAL')).toHaveLength(9);expect(holidays.find(h=>h.name.startsWith('Sexta-feira'))?.date).toBe('2027-03-26');expect(holidays.find(h=>h.name.startsWith('Sexta-feira'))?.enabled).toBe(false);expect(holidays.some(h=>/carnaval|corpus/i.test(h.name))).toBe(false);
  expect(previousSaturday('2027-01-01')).toBe('2026-12-26');const state=escalaFixture();state.holidays=holidays.map((h,i)=>({...h,id:'h'+i,revision:1}));expect(specialSaturday(state,'2026-12-26')).toHaveLength(1);
 });
 it('movimenta a equipe completa e troca folgas, mantendo a versão anterior disponível para desfazer',()=>{
  const state=escalaFixture(),plan=generateMonth(state,'2027-02-01','move').plan,from=plan.days[0],to=plan.days[1],one=from.duties.find(d=>d.mode==='REST')!,two=to.duties.find(d=>d.mode==='REST')!;
  const moved=moveRest(state,plan,one.team_id,from.date,to.date,two.team_id);expect(moved.days[1].duties.find(d=>d.team_id===one.team_id)?.mode).toBe('REST');expect(moved.days[0].duties.find(d=>d.team_id===two.team_id)?.mode).toBe('REST');expect(plan.days[0].manual).toBe(false);expect(moved.days[0].manual).toBe(true);expect(moved.days[1].duties.find(d=>d.team_id===one.team_id)?.members).toEqual(one.members);
  expect(()=>moveRest(state,plan,one.team_id,from.date,'2027-02-07')).toThrow(/domingo/);
 });
 it('aplica as datas da transição de jornada e bloqueia excesso de dias, horas e descanso reduzido',()=>{
  expect(legalWeeklyMinutes('2026-12-15')).toBe(2640);expect(legalWeeklyMinutes('2026-12-16')).toBe(2520);expect(legalWeeklyMinutes('2027-12-16')).toBe(2400);
  const state=escalaFixture(),plan=generateMonth(state,'2027-02-01','rules').plan;state.rules.min_rest_minutes=600;expect(validatePlan(state,plan).some(i=>i.code==='REST_BASELINE')).toBe(true);state.rules.min_rest_minutes=660;
  for(const day of plan.days.slice(0,6)){const d=day.duties[0];d.mode='ROUTE';d.truck_id=state.trucks[0].id;}const issues=validatePlan(state,plan);expect(issues.some(i=>i.code==='WEEKLY_HOURS')).toBe(true);expect(issues.some(i=>i.code==='CONSECUTIVE')).toBe(true);
  expect(monthDates('2028-02-01')).toHaveLength(29);expect(()=>monthDates('2027-13-01')).toThrow();
 });
});
