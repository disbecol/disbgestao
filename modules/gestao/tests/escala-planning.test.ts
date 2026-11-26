import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth,moveRest,restMoveIssues} from '../src/escala/engine';

describe('Organização de folgas',()=>{
 it('não permite piorar a cobertura de uma data que já tinha pendência',()=>{
  const state=escalaFixture(),plan=generateMonth(state,'2026-11-01','coverage').plan;
  const day=plan.days.find(d=>d.kind==='NORMAL')!;day.required=9;day.duties.forEach((a,i)=>a.mode=i<8?'ROUTE':'REST');
  const next=structuredClone(plan);next.days.find(d=>d.date===day.date)!.duties[0].mode='REST';
  expect(restMoveIssues(state,plan,next).some(i=>i.code==='CAPACITY'&&i.message.includes('8 para 7'))).toBe(true);
 });
 it('preserva rotas concluídas da equipe escolhida e da equipe que faria a troca',()=>{
  const state=escalaFixture(),plan=generateMonth(state,'2026-11-01','completed').plan;
  const from=plan.days.find(d=>d.kind==='NORMAL')!,to=plan.days.find(d=>d.kind==='NORMAL'&&d.date!==from.date)!;const first=state.teams[0].id,other=state.teams[1].id;
  from.duties.find(a=>a.team_id===first)!.mode='REST';from.duties.find(a=>a.team_id===other)!.completed=true;to.duties.find(a=>a.team_id===first)!.mode='ROUTE';to.duties.find(a=>a.team_id===other)!.mode='REST';
  expect(()=>moveRest(state,plan,first,from.date,to.date,other)).toThrow(/rota realizada/);
 });
});
