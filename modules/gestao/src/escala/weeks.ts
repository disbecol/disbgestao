import {monthDates,plusDays,weekday} from './engine.ts';
export const weekStart=(date:string)=>plusDays(date,-((weekday(date)+6)%7));
export const weekDates=(start:string)=>Array.from({length:7},(_,i)=>plusDays(start,i));
export function monthWeeks(month:string){const last=monthDates(month).at(-1)!,weeks:string[]=[];for(let start=weekStart(month);start<=last;start=plusDays(start,7))weeks.push(start);return weeks;}
