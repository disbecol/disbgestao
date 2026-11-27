import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {generateMonth,weekday,exportMatrix} from '../src/escala/engine';
function fixture(){const s=escalaFixture();s.trucks=[];s.memberships.slice(0,6).forEach(m=>{m.origin='MANUAL';m.draw_month=null;});return s;}
const weekdayRest=(plan:ReturnType<typeof generateMonth>['plan'])=>new Set(plan.days.filter(d=>d.kind==='NORMAL'&&weekday(d.date)>0&&weekday(d.date)<6).flatMap(d=>d.duties.filter(a=>a.mode==='REST').map(a=>a.team_id)));
describe('disponibilidade de colaboradores sem veículos',()=>{
 it('mantém nove grupos disponíveis nos dias úteis e cinco aos sábados sem cadastrar caminhões',()=>{const s=fixture();const {plan,issues}=generateMonth(s,'2026-11-01','no-trucks');expect(issues).toEqual([]);for(const day of plan.days){expect(day.duties.filter(a=>a.mode==='ROUTE')).toHaveLength(weekday(day.date)===0?0:weekday(day.date)===6?5:9);for(const fixed of s.teams.slice(0,2))expect(day.duties.find(a=>a.team_id===fixed.id)?.mode).toBe([0,6].includes(weekday(day.date))?'REST':'ROUTE');}expect(exportMatrix(s,plan)[0]).toContain('Colaborador');expect(exportMatrix(s,plan)[0]).not.toContain('Caminhão');});
});
