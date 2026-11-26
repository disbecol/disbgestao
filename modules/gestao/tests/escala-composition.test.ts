import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {crewAdjustmentErrors,drawCrew,crewRole,manualCrew,moveCrewHelper,refreshPlanMembers} from '../src/escala/composition';
import {generateMonth} from '../src/escala/engine';
function fixture(){const s=escalaFixture();s.staff.forEach(p=>{p.area='Entrega';});s.memberships=s.memberships.filter(m=>s.teams.slice(0,2).some(t=>m.team_id===t.id));s.memberships.forEach(m=>{m.origin='MANUAL';m.draw_month=null;});return s;}
describe('Sorteio dos colaboradores das equipes',()=>{
 it('preserva as equipes 1 e 2 e distribui 1 motorista e 2 ajudantes nas equipes 3 a 10',()=>{
  const s=fixture(),before=structuredClone(s),p=drawCrew(s,'2027-02-01','crew');expect(p.errors).toEqual([]);expect(p.fixed.map(t=>t.id)).toEqual(s.teams.slice(0,2).map(t=>t.id));expect(p.assignments).toHaveLength(8);
  const used=p.assignments.flatMap(a=>a.members);expect(new Set(used).size).toBe(24);for(const a of p.assignments){const people=a.members.map(id=>s.staff.find(p=>p.id===id)!);expect(people.filter(p=>crewRole(p.job)==='DRIVER')).toHaveLength(1);expect(people.filter(p=>crewRole(p.job)==='HELPER')).toHaveLength(2);}
  expect(used.some(id=>s.memberships.some(m=>m.staff_id===id))).toBe(false);expect(s).toEqual(before);
 });
 it('é reproduzível pelo identificador do sorteio e permite sortear outra composição',()=>{
  const s=fixture();expect(drawCrew(s,'2027-02-01','one').assignments).toEqual(drawCrew(s,'2027-02-01','one').assignments);expect(drawCrew(s,'2027-02-01','one').assignments).not.toEqual(drawCrew(s,'2027-02-01','two').assignments);
 });
 it('pode sortear novamente vínculos automáticos do mês, mas preserva vínculos manuais e de outros períodos',()=>{
  const s=fixture(),p=drawCrew(s,'2027-02-01','first');for(const a of p.assignments)for(const id of a.members)s.memberships.push({id:'auto-'+id,team_id:a.team_id,staff_id:id,starts_on:'2027-02-01',ends_on:'2027-02-28',origin:'AUTO',draw_month:'2027-02-01',override_reason:'',revision:1});
  expect(drawCrew(s,'2027-02-01','second').assignments).toHaveLength(8);expect(manualCrew(s,s.teams[2].id,'2027-02-01')).toBe(false);
  s.memberships.find(m=>m.team_id===s.teams[2].id)!.origin='MANUAL';expect(drawCrew(s,'2027-02-01','third').fixed).toHaveLength(3);
 });
 it('exclui férias, afastamentos, inativos, períodos indisponíveis e funções de outra área',()=>{
  const s=fixture();s.staff[6].status='VACATION';s.staff[6].vacation_start='2027-02-10';s.staff[6].vacation_end='2027-02-15';s.staff[7].status='LEAVE';s.staff[8].status='INACTIVE';s.staff[9].area='Puxada';s.unavailable.push({id:'u',team_id:null,staff_id:s.staff[10].id,starts_on:'2027-02-01',ends_on:'2027-02-02',reason:'Teste',revision:1});
  const p=drawCrew(s,'2027-02-01','availability');expect(p.assignments).toEqual([]);expect(p.errors.some(e=>e.includes('Faltam'))).toBe(true);expect(p.drivers).toBe(6);expect(p.helpers).toBe(13);
 });
 it('permite ajustar ajudantes, informa falta de pessoal e respeita escalas protegidas',()=>{
  const s=fixture();s.staff[7].status='INACTIVE';expect(drawCrew(s,'2027-02-01','short',2).errors).toContain('Faltam 1 ajudante(s) disponível(is) para o mês.');expect(drawCrew(s,'2027-02-01','short',1).assignments).toHaveLength(8);expect(drawCrew(s,'2027-02-01','invalid',-1).assignments).toEqual([]);
  s.plan={id:'p',month:'2027-02-01',status:'APPROVED',days:[],revision:1,seed:'',algorithm_version:'',notes:'',approved_at:null,approved_by:null};expect(drawCrew(s,'2027-02-01','locked').errors.some(e=>e.includes('protegida'))).toBe(true);
 });
 it('atualiza somente integrantes das escalas abertas e mantém os snapshots concluídos ou bloqueados',()=>{
  const s=fixture();s.plan=generateMonth(s,'2027-02-01','history').plan;const completed=s.plan.days[1].duties[0],locked=s.plan.days[2];completed.completed=true;completed.members=[{id:'previous',name:'Pessoa anterior',job:'Motorista',profile_id:null}];locked.locked=true;
  const before=structuredClone(s.plan),p=drawCrew(s,'2027-02-01','history-crew');expect(p.errors).toEqual([]);
  for(const a of p.assignments)for(const id of a.members)s.memberships.push({id:'auto-'+id,team_id:a.team_id,staff_id:id,starts_on:'2027-02-01',ends_on:'2027-02-28',origin:'AUTO',draw_month:'2027-02-01',override_reason:'',revision:1});
  const next=refreshPlanMembers(s,s.plan);expect(next.days[1].duties[0]).toEqual(before.days[1].duties[0]);expect(next.days[2]).toEqual(before.days[2]);expect(next.days[3].duties.find(d=>d.team_id===s.teams[4].id)!.members).toHaveLength(3);expect(s.plan).toEqual(before);
 });
 it('QLP de 8 motoristas e 13 ajudantes forma 5 equipes com 2 e 3 com 1 ajudante',()=>{
  const s=fixture();for(const n of [7,8,10])s.staff[n].status='INACTIVE';const p=drawCrew(s,'2027-02-01','qlp');
  expect(p.errors).toEqual([]);expect(p.fixed).toHaveLength(2);expect(p.drivers).toBe(8);expect(p.helpers).toBe(13);expect(p.usedHelpers).toBe(13);expect(p.assignments.filter(a=>a.members.length===3)).toHaveLength(5);expect(p.assignments.filter(a=>a.members.length===2)).toHaveLength(3);expect(new Set(p.assignments.flatMap(a=>a.members)).size).toBe(21);
  expect(drawCrew(s,'2027-02-01','qlp').assignments).toEqual(p.assignments);expect(drawCrew(s,'2027-02-01','other').assignments.map(a=>a.members.length)).not.toEqual(p.assignments.map(a=>a.members.length));
 });
 it('modo QLP exige pelo menos um ajudante por equipe e mantém excedentes disponíveis',()=>{
  const s=fixture(),free=s.staff.filter(p=>p.job==='Ajudante'&&!s.memberships.some(m=>m.staff_id===p.id));for(const p of free.slice(0,8))p.status='INACTIVE';expect(drawCrew(s,'2027-02-01','minimum').assignments.every(a=>a.members.length===2)).toBe(true);
  free[8].status='INACTIVE';expect(drawCrew(s,'2027-02-01','missing').errors).toContain('Faltam 1 ajudante(s) disponível(is) para o mês.');
  for(const p of free)p.status='ACTIVE';s.staff.push({...free[0],id:'extra-helper'});const p=drawCrew(s,'2027-02-01','extra');expect(p.usedHelpers).toBe(16);expect(p.remaining.map(p=>p.id)).toHaveLength(1);
 });
 it('move ajudantes entre equipes sem duplicar pessoas nem alterar os motoristas',()=>{
  const s=fixture();for(const n of [7,8,10])s.staff[n].status='INACTIVE';const p=drawCrew(s,'2027-02-01','drag'),before=structuredClone(p.assignments),source=p.assignments.find(a=>a.members.length===3)!,target=p.assignments.find(a=>a.members.length===2)!,id=source.members[1];
  const next=moveCrewHelper(s,p.assignments,id,target.team_id);expect(crewAdjustmentErrors(s,next,0)).toEqual([]);expect(next.find(a=>a.team_id===source.team_id)!.members).not.toContain(id);expect(next.find(a=>a.team_id===target.team_id)!.members).toContain(id);expect(new Set(next.flatMap(a=>a.members)).size).toBe(21);expect(next.map(a=>a.members[0])).toEqual(before.map(a=>a.members[0]));expect(p.assignments).toEqual(before);
 });
 it('troca dois ajudantes diretamente e impede mover motorista ou atingir uma equipe preservada',()=>{
  const s=fixture(),p=drawCrew(s,'2027-02-01','swap'),[a,b]=p.assignments,x=a.members[1],y=b.members[1];const next=moveCrewHelper(s,p.assignments,x,b.team_id,y);expect(next[0].members).toContain(y);expect(next[1].members).toContain(x);expect(crewAdjustmentErrors(s,next,2)).toEqual([]);
  expect(()=>moveCrewHelper(s,p.assignments,a.members[0],b.team_id)).toThrow(/ajudante/);expect(()=>moveCrewHelper(s,p.assignments,x,p.fixed[0].id)).toThrow(/disponível/);expect(()=>moveCrewHelper(s,p.assignments,x,b.team_id,b.members[0])).toThrow(/dois ajudantes/);
 });
 it('identifica os ajustes incompletos até que o usuário termine de reorganizar as equipes',()=>{
  const s=fixture();for(const n of [7,8,10])s.staff[n].status='INACTIVE';const p=drawCrew(s,'2027-02-01','incomplete'),source=p.assignments.find(a=>a.members.length===2)!,target=p.assignments.find(a=>a.members.length===3)!,id=source.members[1];const next=moveCrewHelper(s,p.assignments,id,target.team_id);expect(crewAdjustmentErrors(s,next,0)).toHaveLength(2);
  const restored=moveCrewHelper(s,next,id,source.team_id);expect(crewAdjustmentErrors(s,restored,0)).toEqual([]);expect(restored).toEqual(p.assignments);
 });
});
