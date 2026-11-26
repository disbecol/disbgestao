import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth} from '../src/escala/engine';
import {restMoveForAssignment} from '../src/escala/assignment-move';
import {moveIndividualRest} from '../src/escala/individual-move';
import {holidayRest} from '../src/escala/rest-status';
function fixture(){const state=escalaFixture();state.individual_enabled=true;state.teams=state.teams.slice(0,2).map(t=>({...t,fixed_group:true}));state.memberships=state.memberships.slice(0,6).map(m=>({...m,origin:'MANUAL' as const}));state.staff=state.staff.filter(p=>!['team-8-person-2','team-9-person-2','team-10-person-2'].includes(p.id));const plan=generateMonth(state,'2027-02-01','assignments').plan;return {state,plan};}
describe('arraste iniciado por escalado ou de folga',()=>{
 it('inverte o movimento ao arrastar um escalado para o seu dia de folga e mantém as duas folgas',()=>{
  const {state,plan}=fixture(),source=plan.days[1].people!.find(p=>!p.fixed_team_id&&p.mode==='REST'&&p.person.job==='Ajudante')!,partner=plan.days[0].people!.find(p=>!p.fixed_team_id&&p.mode==='REST'&&p.person.job==='Ajudante')!,rest=restMoveForAssignment(state,plan,{person:source.person.id,from:'2027-02-01',to:'2027-02-02',swap:partner.person.id});expect(rest.from).toBe('2027-02-02');expect(rest.to).toBe('2027-02-01');const next=moveIndividualRest(state,plan,rest.person,rest.from,rest.to,rest.swap);expect(next.days[0].people!.find(p=>p.person.id===source.person.id)?.mode).toBe('REST');expect(next.days[1].people!.find(p=>p.person.id===source.person.id)?.mode).toBe('ROUTE');for(const person of state.staff)expect(next.days.slice(0,7).filter(d=>d.people!.some(p=>p.person.id===person.id&&p.mode==='REST'))).toHaveLength(2);
 });
 it('preserva a situação de apoio e abre a edição pelo dia de trabalho correto',()=>{
  const {state,plan}=fixture(),source=plan.days[1].people!.find(p=>!p.fixed_team_id&&p.mode==='REST'&&p.person.job==='Motorista')!,partner=plan.days[0].people!.find(p=>!p.fixed_team_id&&p.mode==='REST'&&p.person.job==='Motorista')!;plan.days[0].people!.find(p=>p.person.id===source.person.id)!.mode='RESERVE';const rest=restMoveForAssignment(state,plan,{person:source.person.id,from:'2027-02-01',to:'2027-02-02',swap:partner.person.id}),next=moveIndividualRest(state,plan,rest.person,rest.from,rest.to,rest.swap);expect(next.days[1].people!.find(p=>p.person.id===source.person.id)?.mode).toBe('RESERVE');expect(restMoveForAssignment(state,plan,{person:source.person.id,from:'2027-02-01',to:''})).toMatchObject({from:'2027-02-02',to:'2027-02-01'});
 });
 it('não inventa mudança quando a pessoa já trabalha nos dois dias e mantém a equipe fixa protegida',()=>{
  const {state,plan}=fixture(),source=plan.days[5].people!.find(p=>!p.fixed_team_id&&p.mode==='REST')!,fixed=plan.days[0].people!.find(p=>p.fixed_team_id)!;expect(()=>restMoveForAssignment(state,plan,{person:source.person.id,from:'2027-02-01',to:'2027-02-02'})).toThrow(/já está escalada nos dois dias/);expect(()=>restMoveForAssignment(state,plan,{person:fixed.person.id,from:'2027-02-01',to:'2027-02-06'})).toThrow(/equipe fixa/);expect(holidayRest(state,plan.days[6],'REST')).toBe(false);
 });
});
