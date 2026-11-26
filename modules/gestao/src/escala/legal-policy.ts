import type {EscalaState,Issue,PersonDuty,Rules} from './model';

// EC 141/2026, arts. 6–7; CLT, arts. 58–59, 66–67 and 71.
// The ceilings do not increase a shorter contractual working week.
export function legalWeeklyMinutes(date:string){return date>='2027-12-16'?2400:date>='2026-12-16'?2520:2640;}
export function weeklyRest(state:Pick<EscalaState,'holidays'>,date:string,duty:PersonDuty|undefined){
 if(duty?.mode!=='REST')return false;
 const dow=new Date(date+'T12:00:00Z').getUTCDay();
 if(dow===0||duty.fixed_team_id&&dow===6)return true;
 const holiday=state.holidays.some(h=>h.date===date&&h.enabled&&h.kind!=='OPTIONAL'&&!h.operates);
 if(!holiday)return true;
 // Keep the old calendar interpretation without rewriting historical rows.
 return duty.weekly_rest??dow===6;
}
export function legalRuleIssues(r:Rules):Issue[]{
 const issues:Issue[]=[],add=(code:string,message:string)=>issues.push({code,message,severity:'ERROR'});
 if(r.work_minutes>480&&(!r.daily_compensation||!r.collective_reference.trim()||!r.reviewed_on))add('DAILY_COMPENSATION','Jornada normal acima de 8h exige compensação autorizada e referência do acordo coletivo cadastrada.');
 if(r.work_minutes+r.overtime_minutes>600||r.overtime_minutes>120||r.daily_limit>600)add('DAILY_HOURS','Revise a jornada diária e as horas extras do regime geral da CLT.');
 if(r.min_rest_minutes<660||r.weekly_rest_minutes<1440||r.max_consecutive>6)add('REST_BASELINE','Preserve 11h entre jornadas, cada folga de 24h e no máximo seis dias consecutivos de trabalho.');
 return issues;
}
