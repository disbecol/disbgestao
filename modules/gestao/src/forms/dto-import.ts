import type { Answer, FormBuilder } from './models.ts';

export type SourceCell = {ref: string; value: string | number | null; formula?: string; style?: number; type?: string};
export type SourceSheet = {name: string; state?: string; cells: SourceCell[]};
export type SourceWorkbook = {date1904?: string; sheets: SourceSheet[]};
export type DtoQuestion = {column: string; label: string; kind: 'BOOLEAN' | 'LONG_TEXT'};
export type DtoApplication = {
  sheet: string; row: number; sourceDate: string | number | null; date: string | null;
  hasTime: boolean; name: string; role: string; answers: Record<string, string | number>;
  metadata: Record<string, string | number | null>; expectedOk: number | null; expectedEligible: number | null;
  dateEstimated?: {method: string; intervals: number[]; intervalDays: number};
};
export type DtoTemplate = {sheet: string; hidden: boolean; headerRow: number; questions: DtoQuestion[]; applications: DtoApplication[]};
export type DtoAnalysis = {templates: DtoTemplate[]; supportSheets: string[]; warnings: string[]};
const text = (value: unknown) => String(value ?? '').trim();
export const dtoKey = (value: unknown) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
const col = (ref: string) => ref.replace(/\d/g,'');
const row = (ref: string) => Number(ref.replace(/\D/g,''));
const colIndex = (name: string) => [...name].reduce((n,c) => n * 26 + c.charCodeAt(0) - 64, 0);
const DAY = 86400000;
export function excelDate(value: unknown, date1904 = false): {date: string | null; hasTime: boolean} {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 2958466) {
    const milliseconds = Math.round(value * DAY);
    return {date: new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + milliseconds).toISOString().slice(0,19), hasTime: Math.abs(value - Math.floor(value)) > 1e-8};
  }
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [,d,m,y,h='00',min='00',s='00'] = match;
    const stamp = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${s}`;
    const parsed = new Date(stamp+'Z');
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,19) === stamp) return {date:stamp,hasTime:!!match[4]};
  }
  return {date:null,hasTime:false};
}
export function estimateApplicationDate(applications: DtoApplication[], target: DtoApplication): void {
  const dates = applications.filter(item => item.row < target.row && item.date && !item.dateEstimated)
    .map(item => item.date!.slice(0,10)).filter((value,index,values) => values.indexOf(value) === index).sort();
  if (dates.length < 2) throw Error(`Não há intervalo suficiente para estimar ${target.sheet}, linha ${target.row}.`);
  const intervals = dates.slice(1).map((value,index) => (Date.parse(value+'T00:00:00Z') - Date.parse(dates[index]+'T00:00:00Z')) / DAY);
  const intervalDays = Math.round(intervals.reduce((n,value) => n + value,0) / intervals.length);
  target.date = new Date(Date.parse(dates.at(-1)!+'T00:00:00Z') + intervalDays * DAY).toISOString().slice(0,19);
  target.dateEstimated = {method:'Intervalo médio entre as datas anteriores da mesma aba, autorizado pelo usuário.',intervals,intervalDays};
}
export function parseDtoWorkbook(workbook: SourceWorkbook): DtoAnalysis {
  const result: DtoAnalysis = {templates:[],supportSheets:[],warnings:[]};
  for (const sheet of workbook.sheets) {
    const dateHeader = sheet.cells.find(cell => col(cell.ref) === 'G' && dtoKey(cell.value) === 'DATA');
    if (!dateHeader) { result.supportSheets.push(sheet.name); continue; }
    const headerRow = row(dateHeader.ref), headers = sheet.cells.filter(cell => row(cell.ref) === headerRow);
    const roleHeader = headers.find(cell => dtoKey(cell.value) === 'FUNCAO');
    if (!roleHeader) throw Error(`Coluna Função não encontrada em ${sheet.name}.`);
    const roleColumn = col(roleHeader.ref);
    const isReview = (label: string) => /REVI(E)?WER|REVISOR/.test(dtoKey(label)) || dtoKey(label) === 'DATA';
    const questionHeaders = headers.filter(cell => colIndex(col(cell.ref)) > colIndex(roleColumn) && text(cell.value) && !isReview(text(cell.value)));
    const questions: DtoQuestion[] = questionHeaders.map(cell => ({column:col(cell.ref),label:text(cell.value),kind:/CASO EXISTA ALGO A ACRESCENTAR/.test(dtoKey(cell.value)) ? 'LONG_TEXT' : 'BOOLEAN'}));
    const template: DtoTemplate = {sheet:sheet.name,hidden:sheet.state === 'hidden' || sheet.state === 'veryHidden',headerRow,questions,applications:[]};
    const rows = new Map<number,Map<string,SourceCell>>();
    for (const cell of sheet.cells) {
      if (row(cell.ref) <= headerRow) continue;
      if (!rows.has(row(cell.ref))) rows.set(row(cell.ref),new Map());
      rows.get(row(cell.ref))!.set(col(cell.ref),cell);
    }
    for (const [n,cells] of rows) {
      const populated = [...cells.values()].some(cell => colIndex(col(cell.ref)) >= 7 && !('formula' in cell) && text(cell.value));
      if (!populated) continue;
      const name = text(cells.get('H')?.value);
      if (!name) throw Error(`Aplicação sem colaborador em ${sheet.name}, linha ${n}.`);
      const rawDate = cells.get('G')?.value ?? null, stamp = excelDate(rawDate,workbook.date1904 === '1');
      const application: DtoApplication = {sheet:sheet.name,row:n,sourceDate:rawDate,date:stamp.date,hasTime:stamp.hasTime,name,role:text(cells.get(roleColumn)?.value),answers:{},metadata:{},expectedOk:typeof cells.get('D')?.value === 'number' ? cells.get('D')!.value as number : null,expectedEligible:typeof cells.get('C')?.value === 'number' ? cells.get('C')!.value as number : null};
      for (const question of questions) {
        const value = cells.get(question.column)?.value;
        if (value != null && text(value)) application.answers[question.column] = value;
      }
      for (const cell of cells.values()) {
        const column = col(cell.ref);
        if (colIndex(column) < 7 || ['G','H',roleColumn].includes(column) || questions.some(question => question.column === column) || 'formula' in cell || !text(cell.value)) continue;
        application.metadata[text(headers.find(header => col(header.ref) === column)?.value) || column] = cell.value;
      }
      if (!application.role) result.warnings.push(`${sheet.name}!${roleColumn}${n}: função não informada.`);
      if (!application.date) result.warnings.push(`${sheet.name}!G${n}: data não informada ou inválida.`);
      template.applications.push(application);
    }
    result.templates.push(template);
  }
  return result;
}
export function dtoAnswer(value: string | number | undefined, kind: DtoQuestion['kind']): {answer: Answer; warning?: string} {
  if (value === undefined) return {answer:{}};
  if (kind === 'LONG_TEXT') return {answer:{value:String(value)}};
  const normalized = dtoKey(value).replace(/[\s\]/.]/g,'');
  if (normalized === 'OK') return {answer:{value:'YES'}};
  if (normalized === 'NOK') return {answer:{value:'NO'}};
  if (normalized === 'NA') return {answer:{value:'NA'}};
  return {answer:{observation:`Resposta original não classificada: ${String(value)}`},warning:`Resposta não classificada: ${String(value)}`};
}
export function dtoModel(template: DtoTemplate, unit: string, area: string, areas: string[]): FormBuilder {
  const roles = ['ADMIN','ANALISTA_OPERACOES','SUPERVISOR_OPERACOES','GERENTE_OPERACOES','ROTEIRIZADOR','CONTROLADOR_ENTREGA','COORDENADOR_FROTA','RESPONSAVEL_DTO'];
  return {
    name:`DTO - ${template.sheet}`,description:template.questions.length ? `Modelo extraído da aba ${template.sheet}. Perguntas preservadas para novas aplicações.` : 'A aba original está sem perguntas. Complete este rascunho antes de publicar.',
    area,form_type:'DTO',units:[unit],apply_everyone:false,apply_roles:roles,apply_user_ids:[],report_roles:roles,report_user_ids:[],status:template.questions.length ? 'PUBLISHED' : 'DRAFT',
    schema:{evaluation:{enabled:true,area:areas[0] || area,areas:areas.length ? areas : [area],membership:'AREA'},sections:[{id:'dto_checks',title:'Diagnóstico de trabalho operacional',fields:template.questions.map(question => ({
      id:`dto_${question.column.toLowerCase()}`,label:question.label,type:question.kind,scope:'INDIVIDUAL',required:question.kind === 'BOOLEAN',scored:question.kind === 'BOOLEAN',expected:question.kind === 'BOOLEAN' ? 'YES' : null,allow_na:true,require_note:false,
      ...(question.kind === 'BOOLEAN' ? {positive_label:'OK',negative_label:'NOK'} : {}),
    }))}]},
  };
}
