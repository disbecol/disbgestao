import {defaultRules,type EscalaState} from '../src/escala/model.ts';
export function escalaFixture():EscalaState{
 const state:EscalaState={staff:[],teams:[],trucks:[],memberships:[],unavailable:[],holidays:[],rules:{...defaultRules,collective_reference:'Regime 5x2 de teste',reviewed_on:'2026-11-25'},plan:null,history:[],audit:[],profiles:[],months:[]};
 for(let i=1;i<=10;i++){const id='team-'+i;state.teams.push({id,code:String(i).padStart(2,'0'),name:'Equipe '+i,active:true,draw_enabled:true,notes:'',revision:1});for(let n=0;n<3;n++){const staffId=id+'-person-'+n;state.staff.push({id:staffId,profile_id:null,name:'Pessoa de exemplo '+i+'-'+n,job:n?'Ajudante':'Motorista',status:'ACTIVE',vacation_start:null,vacation_end:null,notes:'',revision:1});state.memberships.push({id:'membership-'+staffId,team_id:id,staff_id:staffId,starts_on:'2020-01-01',ends_on:null,override_reason:'',revision:1});}if(i<=9)state.trucks.push({id:'truck-'+i,label:'Caminhão '+i,plate:'ABC1D'+String(i).padStart(2,'0'),team_id:null,status:'AVAILABLE',notes:'',revision:1});}
 return state;
}
