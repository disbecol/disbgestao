import { describe, expect, it } from 'vitest';
import { dtoAnswer, dtoModel, estimateApplicationDate, excelDate, parseDtoWorkbook } from '../src/forms/dto-import';
import { areaKey, evaluationAreas, USER_ROLES } from '../src/forms/roles';
import type { SourceSheet } from '../src/forms/dto-import';

const cell=(ref:string,value:string|number|null,formula?:string)=>({ref,value,...(formula!==undefined?{formula}:{})});
function sheet(checklist=false): SourceSheet {
  return {name:checklist?'Checklist Entrega':'Entrega',state:'hidden',cells:[
    cell('G28','Data'),cell('H28','Colaborador'),cell(checklist?'J28':'I28','Função'),
    ...(checklist?[cell('I28','Tempo médio do checklist (minutos)')]:[]),
    cell('L28','Conferiu os pneus?'),cell('M28','Caso exista algo a acrescentar, digite abaixo:'),
    cell('Z28','DTO\nREVIEWER'),cell('AA28','DATA'),
    cell('G29',46032.5),cell('H29','Colaborador fictício'),cell(checklist?'J29':'I29','Motorista'),
    ...(checklist?[cell('I29',5/1440)]:[]),cell('L29','NOK'),cell('M29','Peça para revisar.'),cell('Z29','Revisor'),cell('AA29',46033),
    cell('C29',1,'COUNTIF(L29,"OK")+COUNTIF(L29,"NOK")'),cell('D29',0,'COUNTIF(L29,"OK")'),
    cell('A30',1,'MONTH(G30)'),cell('C30',0,'COUNTIF(L30,"OK")'),
  ]};
}
describe('DTO source extraction',()=>{
  it('handles shifted checklist columns, hidden worksheets, notes and review metadata without creating phantom applications',()=>{
    const book=parseDtoWorkbook({sheets:[{name:'Resumo',cells:[cell('A1','Resumo')]},sheet(true)]});
    expect(book.supportSheets).toEqual(['Resumo']);
    const template=book.templates[0],app=template.applications[0];
    expect(template.hidden).toBe(true);expect(template.applications).toHaveLength(1);
    expect(template.questions).toEqual([{column:'L',label:'Conferiu os pneus?',kind:'BOOLEAN'},{column:'M',label:'Caso exista algo a acrescentar, digite abaixo:',kind:'LONG_TEXT'}]);
    expect(app.role).toBe('Motorista');expect(app.metadata['Tempo médio do checklist (minutos)']).toBe(5/1440);
    expect(app.metadata['DTO\nREVIEWER']).toBe('Revisor');expect(app.expectedEligible).toBe(1);expect(app.expectedOk).toBe(0);
    expect(app.answers).toEqual({L:'NOK',M:'Peça para revisar.'});expect(app.date).toBe('2026-01-10T12:00:00');
  });
  it('uses worksheet names even when the visible title was copied from another DTO',()=>{
    const source=sheet();source.name='Inventário';source.cells.push(cell('H1','Descarte de produtos'));
    const parsed=parseDtoWorkbook({sheets:[source]});
    const model=dtoModel(parsed.templates[0],'Matriz Caicó','Armazém',['Armazém','Entrega']);
    expect(model.name).toBe('DTO - Inventário');expect(model.form_type).toBe('DTO');expect(model.status).toBe('PUBLISHED');
    expect(model.schema.sections[0].fields[0]).toMatchObject({type:'BOOLEAN',scope:'INDIVIDUAL',expected:'YES',allow_na:true});
    expect(model.schema.sections[0].fields[1]).toMatchObject({type:'LONG_TEXT',scored:false,required:false});
  });
  it('keeps empty DTOs as unpublished drafts without inventing questions',()=>{
    const source:SourceSheet={name:'SAM & LOTO',cells:[cell('G28','Data'),cell('H28','Colaborador'),cell('I28','Função')]};
    const parsed=parseDtoWorkbook({sheets:[source]});
    expect(dtoModel(parsed.templates[0],'Matriz Caicó','Segurança',['Armazém']).status).toBe('DRAFT');
    expect(parsed.templates[0].questions).toEqual([]);
  });
  it('preserves unrecognized answers instead of converting them into compliance or N/A',()=>{
    expect(dtoAnswer('N/A','BOOLEAN').answer.value).toBe('NA');expect(dtoAnswer('NA]','BOOLEAN').answer.value).toBe('NA');
    expect(dtoAnswer('OK','BOOLEAN').answer.value).toBe('YES');expect(dtoAnswer('NOK','BOOLEAN').answer.value).toBe('NO');
    expect(dtoAnswer('MA','BOOLEAN')).toEqual({answer:{observation:'Resposta original não classificada: MA'},warning:'Resposta não classificada: MA'});
    expect(dtoAnswer(undefined,'BOOLEAN').answer).toEqual({});
  });
  it('estimates only a specifically requested missing date and keeps the method and observed intervals',()=>{
    const applications=parseDtoWorkbook({sheets:[sheet()]}).templates[0].applications;
    const first={...applications[0],row:29,date:'2026-01-01T00:00:00'},second={...first,row:30,date:'2026-01-11T00:00:00'},third={...first,row:31,date:'2026-01-31T00:00:00'},missing={...first,row:32,date:null,sourceDate:null};
    estimateApplicationDate([first,second,third,missing],missing);
    expect(missing.date).toBe('2026-02-15T00:00:00');expect(missing.dateEstimated).toMatchObject({intervals:[10,20],intervalDays:15});
    expect(first.date).toBe('2026-01-01T00:00:00');expect(missing.sourceDate).toBeNull();
  });
  it('does not substitute today for a missing or invalid date',()=>{
    expect(excelDate(null).date).toBeNull();expect(excelDate('invalid').date).toBeNull();expect(excelDate(46032)).toEqual({date:'2026-01-10T00:00:00',hasTime:false});
    for(const invalid of ['32/11/2026','31/02/2026','01/13/2026','25/11/2026 25:00']) expect(excelDate(invalid).date).toBeNull();
  });
});
describe('shared roles and evaluation areas',()=>{
  it('keeps distinct jobs with the appropriate departments and deduplicates accented area labels',()=>{
    expect(USER_ROLES.find(role=>role.code==='EMPILHADOR')?.area).toBe('Armazém');
    expect(USER_ROLES.find(role=>role.code==='AJUDANTE_ENTREGA')?.area).toBe('Entrega');
    expect(new Set(USER_ROLES.map(role=>role.code)).size).toBe(USER_ROLES.length);
    expect(evaluationAreas({area:'Armazém',areas:['ARMAZEM','Entrega','Entrega']})).toEqual(['Armazém','Entrega']);
    expect(areaKey(' Armazém ')).toBe('armazem');
  });
});
