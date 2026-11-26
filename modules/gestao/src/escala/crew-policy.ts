import type {EscalaState,Membership} from './model';

export const overlapsMonth=(membership:Membership,month:string)=>membership.starts_on.slice(0,7)<=month.slice(0,7)&&(!membership.ends_on||membership.ends_on>=month);
export function manualCrew(state:EscalaState,team:string,month:string){return state.memberships.some(m=>m.team_id===team&&m.origin!=='AUTO'&&overlapsMonth(m,month));}
