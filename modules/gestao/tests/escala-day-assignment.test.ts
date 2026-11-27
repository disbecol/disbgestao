import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth,validatePlan} from '../src/escala/engine';
import {assignIndividualDay} from '../src/escala/day-assignment';

function fixture(){const state=escalaFixture();state.individual_enabled=true;state.teams=state.teams.slice(0,2).map(t=>({...t,fixed_group:true}));state.memberships=state.memberships.slice(0,6).map(m=>({...m,origin:'MANUAL' as const,draw_month:null}));state.staff=state.staff.filter(p=>!['team-8-person-2','team-9-person-2','team-10-person-2'].includes(p.id));return {state,plan:generateMonth(state,'2027-02-01','direct').plan};}
describe('remanejamento direto de uma pessoa no rascunho',()=>{
 it('acrescenta uma terceira folga sem trocar ninguém nem mudar o dia de origem e sinaliza os excessos',()=>{
  const {state,plan}=fixture(),before=structuredClone(plan),person=plan.days[1].people!.find(p=>!p.fixed_team_id&&p.mode==='REST'&&p.person.job==='Ajudante')!;
  const next=assignIndividualDay(state,plan,{person:person.person.id,from:'2027-02-02',to:'2027-02-01',mode:'REST'});
  expect(next.days[0].people!.filter(p=>p.person.job==='Ajudante'&&p.mode==='REST')).toHaveLength(3);expect(next.days[0].people!.filter(p=>p.person.job==='Ajudante'&&p.mode==='ROUTE')).toHaveLength(14);expect(next.days.slice(1)).toEqual(before.days.slice(1));
  expect(next.days[0].people!.filter(p=>p.person.id!==person.person.id)).toEqual(before.days[0].people!.filter(p=>p.person.id!==person.person.id));expect(plan).toEqual(before);expect(next.days[0].manual).toBe(true);const issues=validatePlan(state,next);expect(issues.some(i=>i.code==='REST_CAPACITY'&&i.date==='2027-02-01')).toBe(true);expect(issues.some(i=>i.code==='DOUBLE_REST'&&i.message.includes(person.person.name))).toBe(true);
 });
 it('permite tirar a única folga da semana no mesmo dia e mostra o nome, a contagem e a semana afetada',()=>{
  const {state,plan}=fixture(),person=plan.days[0].people!.find(p=>!p.fixed_team_id&&p.mode==='REST')!;
  const next=assignIndividualDay(state,plan,{person:person.person.id,from:'2027-02-01',to:'2027-02-01',mode:'ROUTE'}),issue=validatePlan(state,next).find(i=>i.code==='PERSON_WEEKLY_REST'&&i.message.includes(person.person.name));
  expect(next.days[0].people!.find(p=>p.person.id===person.person.id)?.mode).toBe('ROUTE');expect(issue?.message).toContain('apenas 1 folga');expect(issue?.message).toContain('01/02/2027 a 07/02/2027');expect(validatePlan(state,next).some(i=>i.code==='PERSON_WEEKLY')).toBe(true);expect(next.days.slice(1)).toEqual(plan.days.slice(1));
 });
 it('troca a situação no mesmo dia, admite outra semana e preserva apoio quando a origem está em apoio',()=>{
  const {state,plan}=fixture(),person=plan.days[0].people!.find(p=>!p.fixed_team_id&&p.mode==='ROUTE')!;person.mode='RESERVE';const next=assignIndividualDay(state,plan,{person:person.person.id,from:'2027-02-01',to:'2027-02-01',mode:'REST'});expect(next.days[0].people!.find(p=>p.person.id===person.person.id)?.mode).toBe('REST');
  const destination=plan.days.slice(7).find(d=>d.people!.some(p=>p.person.id===person.person.id&&p.mode==='REST'))!;const available=assignIndividualDay(state,plan,{person:person.person.id,from:'2027-02-01',to:destination.date,mode:'ROUTE'});expect(available.days.find(d=>d.date===destination.date)!.people!.find(p=>p.person.id===person.person.id)?.mode).toBe('RESERVE');expect(available.days[0]).toEqual(plan.days[0]);
 });
 it('mantém as proteções de aprovação, realização, bloqueio, domingo, feriado, indisponibilidade e equipe fixa',()=>{
  const {state,plan}=fixture(),person=plan.days[0].people!.find(p=>!p.fixed_team_id&&p.mode==='ROUTE')!,drop={person:person.person.id,from:'2027-02-01',to:'2027-02-01',mode:'REST' as const};
  expect(()=>assignIndividualDay(state,{...plan,status:'APPROVED'},drop)).toThrow(/protegida/);const fixed=plan.days[0].people!.find(p=>p.fixed_team_id)!;expect(()=>assignIndividualDay(state,plan,{...drop,person:fixed.person.id})).toThrow(/equipe fixa/);expect(()=>assignIndividualDay(state,plan,{...drop,to:'2027-02-07',mode:'ROUTE'})).toThrow(/domingo/);
  for(const flag of ['locked','completed','unavailable','holiday'] as const){const s=structuredClone(state),p=structuredClone(plan);if(flag==='locked')p.days[0].locked=true;if(flag==='completed')p.days[0].people!.find(a=>a.person.id===person.person.id)!.completed=true;if(flag==='unavailable')p.days[0].people!.find(a=>a.person.id===person.person.id)!.mode='UNAVAILABLE';if(flag==='holiday')p.days[0].kind='HOLIDAY';expect(()=>assignIndividualDay(s,p,drop)).toThrow();}
 });
});
