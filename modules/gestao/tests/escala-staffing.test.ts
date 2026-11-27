import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth,validatePlan} from '../src/escala/engine';
import {redrawPlan} from '../src/escala/redraw';
import {staffingGoal} from '../src/escala/staffing-policy';
function fixture(){const state=escalaFixture();state.individual_enabled=true;state.teams=state.teams.slice(0,2).map(t=>({...t,fixed_group:true}));state.memberships=state.memberships.slice(0,6).map(m=>({...m,origin:'MANUAL' as const,draw_month:null}));state.staff=state.staff.filter(p=>!['team-8-person-2','team-9-person-2','team-10-person-2'].includes(p.id));return state;}
const available=(plan:ReturnType<typeof generateMonth>['plan'],date:string,job:string)=>plan.days.find(d=>d.date===date)!.people!.filter(p=>p.person.job===job&&['ROUTE','RESERVE'].includes(p.mode)).length;
describe('QLP configurável e novo sorteio dos dois grupos',()=>{
 it('atende 8 motoristas e 14 ajudantes na segunda e usa a exceção por data sem alterar o padrão de outros dias',()=>{
  const state=fixture();state.rules.daily_staffing={weekdays:{'1':{drivers:8,helpers:14}},dates:{'2027-02-08':{drivers:9,helpers:15}}};const {plan,issues}=generateMonth(state,'2027-02-01','goals');expect(available(plan,'2027-02-01','Motorista')).toBe(8);expect(available(plan,'2027-02-01','Ajudante')).toBe(14);expect(available(plan,'2027-02-08','Motorista')).toBe(9);expect(available(plan,'2027-02-08','Ajudante')).toBe(15);expect(available(plan,'2027-02-02','Motorista')).toBe(9);expect(issues).toEqual([]);expect(staffingGoal(state.rules,'2027-02-07','DRIVER')).toBe(0);
 });
 it('sinaliza QLP impossível e mantém duas folgas por pessoa; zero é uma meta válida',()=>{
  const state=fixture();state.rules.daily_staffing={weekdays:{'1':{drivers:12}},dates:{}};const {plan,issues}=generateMonth(state,'2027-02-01','impossible');expect(issues.some(i=>i.code==='QLP_SHORTAGE')).toBe(true);expect(issues.some(i=>i.code==='PERSON_WEEKLY_REST')).toBe(false);state.rules.daily_staffing.weekdays['1'].drivers=0;expect(staffingGoal(state.rules,'2027-02-01','DRIVER')).toBe(0);expect(validatePlan(state,plan).some(i=>i.code==='QLP_SURPLUS'&&i.severity==='WARN')).toBe(true);
 });
 it('refaz ajudantes e motoristas antes preservados por um dia manual, mantendo equipes fixas, bloqueios e realizados',()=>{
  const state=fixture(),first=generateMonth(state,'2027-02-01','first').plan;first.days.forEach(d=>d.manual=true);first.days[1].locked=true;const actual=first.days[2].people!.find(p=>!p.fixed_team_id&&p.mode==='ROUTE')!;actual.completed=true;const copy=structuredClone(first),base=redrawPlan(first)!,next=generateMonth({...state,plan:base},'2027-02-01','second').plan;
  for(const job of ['Motorista','Ajudante']){const rests=(plan:typeof next)=>plan.days.flatMap(d=>d.people!.filter(p=>!p.fixed_team_id&&p.person.job===job&&p.mode==='REST').map(p=>d.date+'|'+p.person.id));expect(rests(next)).not.toEqual(rests(first));}
  expect(next.days[1]).toEqual(first.days[1]);expect(next.days[2].people!.find(p=>p.person.id===actual.person.id)).toEqual(actual);for(const day of next.days)for(const person of day.people!.filter(p=>p.fixed_team_id))expect(person.mode).toBe([0,6].includes(new Date(day.date+'T12:00:00Z').getUTCDay())?'REST':'ROUTE');expect(first).toEqual(copy);expect(redrawPlan(first,true)).toBe(first);
 });
});
