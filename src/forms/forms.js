(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DISB_FORMS=api;
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const TYPES={BOOLEAN:'Sim / Não / Não se aplica',TEXT:'Texto curto',LONG_TEXT:'Texto longo',NUMBER:'Número',DATE:'Data',SINGLE_CHOICE:'Uma opção',MULTIPLE_CHOICE:'Várias opções',PHOTO:'Fotos / anexos de imagem'};
  const FORM_TYPES={CHECKLIST:'Checklist',DTO:'DTO',GSP:'GSP',GSDPQ:'GSDPQ',GSA:'GSA',GSR:'GSR',ANOMALY:'Relato de anomalia',SAFETY:'Segurança','5S':'5S',OTHER:'Outros'};
  const MONTHS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const clean=v=>String(v??'').trim();
  const key=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>crypto.randomUUID();
  const fields=s=>(s?.sections||[]).flatMap(section=>(section.fields||[]).map(field=>({...field,section_id:section.id,section_title:section.title})));
  const empty=v=>v===null||v===undefined||v===''||(Array.isArray(v)&&!v.length);
  function validateSchema(schema){
    if(!schema||!Array.isArray(schema.sections)||!schema.sections.length||schema.sections.length>30)throw Error('Adicione entre 1 e 30 seções.');
    const ids=new Set();let count=0;
    for(const section of schema.sections){
      if(!/^[\w-]{1,80}$/.test(section.id)||ids.has(section.id))throw Error('Identificador de seção inválido ou repetido.');
      ids.add(section.id);
      if(!clean(section.title)||clean(section.title).length>150)throw Error('Informe o título de cada seção (até 150 caracteres).');
      if(!Array.isArray(section.fields)||!section.fields.length)throw Error(`Adicione perguntas em “${section.title}”.`);
      for(const field of section.fields){
        count++;
        if(!/^[\w-]{1,80}$/.test(field.id)||ids.has(field.id))throw Error('Identificador de pergunta inválido ou repetido.');
        ids.add(field.id);
        if(!TYPES[field.type]||!clean(field.label)||clean(field.label).length>500)throw Error('Revise o título e o tipo de cada pergunta.');
        if(clean(field.help).length>500)throw Error('A orientação da pergunta deve ter até 500 caracteres.');
        if(!['GROUP','INDIVIDUAL'].includes(field.scope||'GROUP'))throw Error('Revise o alcance da resposta.');
        if(field.scope==='INDIVIDUAL'&&!schema.evaluation?.enabled)throw Error('Ative a avaliação de colaboradores para usar perguntas individuais.');
        if(['SINGLE_CHOICE','MULTIPLE_CHOICE'].includes(field.type)){
          if(!Array.isArray(field.options)||field.options.length<2||field.options.length>30||field.options.some(o=>!clean(o)||clean(o).length>150)||new Set(field.options).size!==field.options.length)throw Error(`Informe de 2 a 30 opções diferentes em “${field.label}”.`);
        }
        if(field.scored){
          if(!['BOOLEAN','SINGLE_CHOICE'].includes(field.type))throw Error('Somente perguntas Sim/Não ou de uma opção podem compor a conformidade.');
          if(!(field.type==='BOOLEAN'?['YES','NO']:field.options).includes(field.expected))throw Error(`Escolha a resposta conforme de “${field.label}”.`);
        }
        if(field.type==='NUMBER'&&field.min!=null&&field.max!=null&&Number(field.min)>Number(field.max))throw Error(`O mínimo deve ser menor que o máximo em “${field.label}”.`);
      }
    }
    if(count>300)throw Error('O formulário pode ter até 300 perguntas.');
    if(schema.evaluation?.enabled&&(!clean(schema.evaluation.area)||clean(schema.evaluation.area).length>100))throw Error('Selecione a área que será avaliada.');
    return schema;
  }
  function outcome(field,answer){
    const value=answer?.value;
    if(!field.scored||empty(value))return null;
    if(value==='NA'&&field.type==='BOOLEAN')return 'NA';
    return value===field.expected?'OK':'NOK';
  }
  function validateAnswers(schema,answers,final=false){
    const normalized={},errors=[];
    for(const field of fields(schema)){
      const answer=answers?.[field.id]||{},value=field.type==='PHOTO'?(answer.photos||[]):answer.value,observation=clean(answer.observation),plan=clean(answer.plan),photos=answer.photos||[];
      if(!Array.isArray(photos)||photos.length>5||photos.some(p=>typeof p!=='string'||p.length>250))errors.push({id:field.id,message:'Adicione no máximo 5 fotos por resposta.'});
      if(observation.length>2000||plan.length>2000)errors.push({id:field.id,message:'A observação e o plano devem ter até 2.000 caracteres.'});
      if(empty(value)){
        if(final&&field.required)errors.push({id:field.id,message:`Preencha “${field.label}”.`});
        continue;
      }
      let valid=true;
      if(field.type==='BOOLEAN')valid=['YES','NO',...(field.allow_na?['NA']:[])].includes(value);
      if(['TEXT','LONG_TEXT'].includes(field.type))valid=typeof value==='string'&&value.trim().length>0&&value.length<=(field.type==='TEXT'?500:4000);
      if(field.type==='NUMBER')valid=typeof value==='number'&&Number.isFinite(value)&&(field.min==null||value>=Number(field.min))&&(field.max==null||value<=Number(field.max));
      if(field.type==='DATE')valid=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
      if(field.type==='SINGLE_CHOICE')valid=field.options.includes(value);
      if(field.type==='MULTIPLE_CHOICE')valid=Array.isArray(value)&&new Set(value).size===value.length&&value.every(v=>field.options.includes(v));
      if(!valid)errors.push({id:field.id,message:`Revise a resposta de “${field.label}”.`});
      normalized[field.id]={value,observation,plan:outcome(field,answer)==='NOK'?plan:'',...(photos.length?{photos}: {})};
      if(final&&outcome(field,answer)==='NOK'&&field.require_note&&!observation)errors.push({id:field.id,message:`Descreva a não conformidade de “${field.label}”.`});
    }
    normalized.__sections={};
    for(const section of schema.sections){const note=clean(answers?.__sections?.[section.id]);if(note.length>2000)errors.push({id:section.fields[0]?.id,message:'A observação da seção deve ter até 2.000 caracteres.'});if(note)normalized.__sections[section.id]=note;}
    return {answers:normalized,errors};
  }
  function score(schema,answers){
    if(schema.evaluation?.enabled&&answers?.__evaluations){const parts=Object.keys(answers.__evaluations).map(person=>score(schema,evaluationAnswers(schema,answers,person))),counts={ok:0,nok:0,na:0,answered:0,total:0};for(const s of parts)for(const k of Object.keys(counts))counts[k]+=s[k];return {...counts,percent:counts.ok+counts.nok?Math.round(counts.ok/(counts.ok+counts.nok)*10000)/100:null};}
    const counts={ok:0,nok:0,na:0,answered:0,total:fields(schema).length};
    for(const field of fields(schema)){
      if(!empty(answers?.[field.id]?.value))counts.answered++;
      const status=outcome(field,answers?.[field.id]);
      if(status)counts[status.toLowerCase()]++;
    }
    return {...counts,percent:counts.ok+counts.nok?Math.round(counts.ok/(counts.ok+counts.nok)*10000)/100:null};
  }
  function answerText(field,answer){
    const value=answer?.value;
    if(empty(value))return '—';
    if(field.type==='PHOTO')return `${(answer?.photos||value||[]).length} foto(s)`;
    if(field.type==='BOOLEAN')return {YES:'Sim',NO:'Não',NA:'Não se aplica'}[value]||'—';
    if(field.type==='DATE')return value.split('-').reverse().join('/');
    if(Array.isArray(value))return value.join(', ');
    return String(value);
  }
  function localDay(value){return value?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';}
  function evaluationAnswers(schema,answers,person){const result={__sections:answers?.__sections||{}};for(const f of fields(schema))result[f.id]=(f.scope==='INDIVIDUAL'?answers?.__evaluations?.[person]?.[f.id]:answers?.[f.id])||{};return result;}
  function assessmentRows(rows){return rows.flatMap(r=>r._evaluation_view?[r]:(r.evaluated_people||[]).length?r.evaluated_people.map(p=>{const answers=evaluationAnswers(r.schema_snapshot,r.answers,p.id);return {...r,answers,evaluated_user_id:p.id,evaluated_name:p.name,evaluated_role:p.role,evaluated_area:p.area,_evaluation_view:true,score:score(r.schema_snapshot,answers).percent};}):[r]);}
  function validateResponse(schema,answers,people,final=false){if(!schema.evaluation?.enabled)return validateAnswers(schema,answers,final);if(!people?.length)return {errors:[{message:'Selecione ao menos uma pessoa avaliada.'}],answers};const errors=[];for(const p of people){const check=validateAnswers(schema,evaluationAnswers(schema,answers,p.id),final);errors.push(...check.errors.map(e=>({...e,person:p.id,message:`${p.name}: ${e.message}`})));}return {errors,answers};}
  function planField(field,person){return field.scope==='INDIVIDUAL'&&person?`${field.id}@${person}`:field.id;}
  function questionMonths(rows,person,year){const relevant=assessmentRows(rows).filter(r=>r.status==='COMPLETED'&&r.evaluated_user_id===person&&localDay(r.started_at).startsWith(String(year))),questions=new Map();for(const r of relevant)for(const f of fields(r.schema_snapshot).filter(f=>f.scored)){const key=r.form_id+':'+f.id;if(!questions.has(key))questions.set(key,{id:f.id,label:f.label,form:r.form_name,months:Array.from({length:12},()=>({ok:0,nok:0,na:0,percent:null}))});const month=Number(localDay(r.started_at).slice(5,7))-1,result=outcome(f,r.answers[f.id]);if(result)questions.get(key).months[month][result.toLowerCase()]++;}for(const q of questions.values())for(const m of q.months)if(m.ok+m.nok)m.percent=Math.round(m.ok/(m.ok+m.nok)*10000)/100;return [...questions.values()];}
  function calendarDays(month){const first=new Date(month+'-01T12:00:00Z'),offset=first.getUTCDay(),start=new Date(first);start.setUTCDate(1-offset);return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);return d.toISOString().slice(0,10);});}
  function evidencePaths(answers){return [...new Set([...Object.values(answers||{}),...Object.values(answers?.__evaluations||{}).flatMap(a=>Object.values(a))].flatMap(a=>Array.isArray(a?.photos)?a.photos:[]))];}
  function summarize(responses){
    const done=responses.filter(r=>r.status==='COMPLETED'),total={completed:done.length,drafts:responses.length-done.length,ok:0,nok:0,na:0,percent:null};
    for(const row of done){const s=score(row.schema_snapshot,row.answers);total.ok+=s.ok;total.nok+=s.nok;total.na+=s.na;}
    total.percent=total.ok+total.nok?Math.round(total.ok/(total.ok+total.nok)*10000)/100:null;
    return total;
  }
  function issues(responses,plans=[]){
    const planMap=new Map(plans.map(p=>[p.response_id+':'+p.field_id,p]));
    return assessmentRows(responses).filter(r=>r.status==='COMPLETED').flatMap(response=>fields(response.schema_snapshot).filter(f=>outcome(f,response.answers?.[f.id])==='NOK').map(field=>({response,field,answer:response.answers[field.id],plan:planMap.get(response.id+':'+planField(field,response.evaluated_user_id))||null})));
  }
  function annual(responses,year){
    return MONTHS.map((label,index)=>{
      const rows=responses.filter(r=>r.status==='COMPLETED'&&localDay(r.started_at).startsWith(`${year}-${String(index+1).padStart(2,'0')}`));
      return {label,month:index+1,...summarize(rows)};
    });
  }
  function csv(rows){return '\uFEFF'+rows.map(row=>row.map(value=>{let v=String(value??'');if(/^[\s]*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
  function exportRows(responses,plans=[]){
    const planMap=new Map(plans.map(p=>[p.response_id+':'+p.field_id,p]));
    const rows=[['Registro','Formulário','Versão','Unidade','Aplicador','Início','Finalização','Status','Conformidade (%)','Seção','Pergunta','Resposta','Resultado','Observação','Plano inicial','Observações da seção','Plano de ação atual','Responsável pelo plano','Prazo do plano','Situação do plano','Conclusão do plano','Pessoa avaliada','Área avaliada','Alcance da resposta','Fotos privadas']];
    for(const r of assessmentRows(responses)){const s=score(r.schema_snapshot,r.answers);for(const f of fields(r.schema_snapshot)){const plan=planMap.get(r.id+':'+planField(f,r.evaluated_user_id));rows.push([r.code,r.form_name,r.form_version,r.unit,r.respondent_name,r.started_at,r.completed_at,r.status,s.percent,f.section_title,f.label,answerText(f,r.answers?.[f.id]),outcome(f,r.answers?.[f.id])||'',r.answers?.[f.id]?.observation||'',r.answers?.[f.id]?.plan||'',r.answers?.__sections?.[f.section_id]||'',plan?.description||'',plan?.responsible_name||'',plan?.due_date||'',plan?.status||'',plan?.completion_note||'',r.evaluated_name||'',r.evaluated_area||'',f.scope==='INDIVIDUAL'?'Individual':'Grupo',(r.answers?.[f.id]?.photos||[]).join(' | ')]);}}
    return rows;
  }
  // XLSX sem dependências externas. Células são texto, nunca fórmulas executáveis.
  function xlsx(rows,sheetName='Respostas'){
    const encode=v=>new TextEncoder().encode(v),xml=v=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0,31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${col(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${col(Math.max(0,rows[0]?.length-1))}${Math.max(1,rows.length)}"/></worksheet>`
    };
    const parts=[],central=[];let offset=0;
    function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
    for(const [name,body] of Object.entries(files)){
      const n=encode(name),b=encode(body),checksum=crc(b),header=new Uint8Array(30),h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,checksum,true);h.setUint32(18,b.length,true);h.setUint32(22,b.length,true);h.setUint16(26,n.length,true);
      const record=new Uint8Array(46),v=new DataView(record.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint32(16,checksum,true);v.setUint32(20,b.length,true);v.setUint32(24,b.length,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);
      parts.push(header,n,b);central.push(record,n);offset+=header.length+n.length+b.length;
    }
    const size=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length/2,true);e.setUint16(10,central.length/2,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
    const all=[...parts,...central,end],out=new Uint8Array(all.reduce((n,p)=>n+p.length,0));let at=0;for(const p of all){out.set(p,at);at+=p.length;}return out;
  }
  return {TYPES,FORM_TYPES,MONTHS,clean,key,esc,id,fields,empty,validateSchema,validateAnswers,validateResponse,evaluationAnswers,assessmentRows,planField,questionMonths,calendarDays,evidencePaths,outcome,score,answerText,localDay,summarize,issues,annual,csv,exportRows,xlsx};
});
