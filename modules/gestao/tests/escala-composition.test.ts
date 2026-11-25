import {describe,it,expect} from 'vitest';
import {escalaFixture} from './escala-fixture';
import {drawCrew,crewRole,manualCrew} from '../src/escala/composition';
function fixture(){const s=escalaFixture();s.staff.forEach(p=>{p.area='Entrega';});s.memberships=s.memberships.filter(m=>s.teams.slice(0,2).some(t=>m.team_id===t.id));return s;}
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
  const s=fixture();s.staff[7].status='INACTIVE';expect(drawCrew(s,'2027-02-01','short').errors).toContain('Faltam 1 ajudante(s) disponível(is) para o mês.');expect(drawCrew(s,'2027-02-01','short',1).assignments).toHaveLength(8);expect(drawCrew(s,'2027-02-01','invalid',0).assignments).toEqual([]);
  s.plan={id:'p',month:'2027-02-01',status:'APPROVED',days:[],revision:1,seed:'',algorithm_version:'',notes:'',approved_at:null,approved_by:null};expect(drawCrew(s,'2027-02-01','locked').errors.some(e=>e.includes('protegida'))).toBe(true);
 });
});
