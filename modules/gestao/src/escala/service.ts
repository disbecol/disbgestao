import type {EscalaState,Rules} from './model';
import {defaultRules} from './model';
import type {CrewAssignment} from './composition';
import {readEscalaDraft} from './drafts.ts';
import {prepareEscalaDraft} from './draft-policy.ts';
export type EscalaAdapter={context():{client:unknown;user:{id:string}|null;profile:{name:string;role:string}|null;unit:string;units:string[]};hasPermission(code:string):boolean;toast(message:string,kind?:string):void;openView(view:string):void;download(name:string,data:Blob):Promise<void>|void};
type Response={data:unknown;error:{message:string;details?:string}|null};
type Client={rpc(name:string,args:Record<string,unknown>):PromiseLike<Response>};
export function createEscalaService(adapter:EscalaAdapter){
 const pending=new Map<string,string>();
 const session=()=>{const c=adapter.context();if(!c.user||!c.client||!c.unit)throw Error('Entre novamente para abrir a escala.');return {...c,user:c.user,client:c.client as Client};};
 const rpc=async(name:string,args:Record<string,unknown>)=>{const context=session(),key=context.user.id+'|'+context.unit,result=await context.client.rpc(name,args);if(key!==session().user.id+'|'+session().unit)throw Error('A unidade ou sessão foi alterada.');if(result.error)throw result.error;return result.data;};
 return {
  key:()=>{const c=session();return c.user.id+'|'+c.unit;},
  async load(month:string):Promise<EscalaState>{
   const c=session(),data=await rpc('escala_state',{p_unit:c.unit,p_month:month}) as EscalaState,priorDate=new Date(month+'T12:00:00Z');priorDate.setUTCMonth(priorDate.getUTCMonth()-1);const priorMonth=priorDate.toISOString().slice(0,7)+'-01';let rotation=data.history||[];
   if(priorMonth>='2020-01-01'){
    const previous=await rpc('escala_state',{p_unit:c.unit,p_month:priorMonth}) as EscalaState;let priorPlan=previous?.plan?.month===priorMonth?previous.plan:null;
    try{const local=readEscalaDraft(JSON.parse(localStorage.getItem('disb_escala_draft_v1_'+c.user.id+'|'+c.unit+'_'+priorMonth)||'null'),priorMonth,priorPlan?.revision||0);if(local&&(!priorPlan||priorPlan.status==='DRAFT'))priorPlan=local;}catch{/* The saved calendar remains the fallback for an invalid local draft. */}
    if(priorPlan){priorPlan=prepareEscalaDraft({...previous,rules:{...defaultRules,...previous.rules}},priorPlan).plan;const days=new Map(rotation.map(d=>[d.date,d]));for(const day of priorPlan?.days||[])days.set(day.date,day);rotation=[...days.values()];}
   }
   return {...data,rotation_history:rotation,rules:{...defaultRules,...(data.rules||{})} as Rules};
  },
  async command(action:string,payload:Record<string,unknown>,id:string|null=null,revision=0):Promise<unknown>{const c=session(),args={p_unit:c.unit,p_action:action,p_id:id,p_revision:revision,p_payload:payload},key=JSON.stringify(args);if(!pending.has(key))pending.set(key,crypto.randomUUID());const result=await rpc('escala_command',{...args,p_request_id:pending.get(key)});pending.delete(key);return result;},
  async saveComposition(month:string,token:string,seed:string,assignments:CrewAssignment[],helpers:number,area:string){const args={p_unit:session().unit,p_month:month,p_token:token,p_seed:seed,p_assignments:assignments,p_helpers:helpers,p_area:area},key='crew|'+JSON.stringify(args);if(!pending.has(key))pending.set(key,crypto.randomUUID());const result=await rpc('escala_save_composition',{...args,p_request_id:pending.get(key)});pending.delete(key);return result;},
  audit:(offset:number)=>rpc('escala_audit_page',{p_unit:session().unit,p_offset:offset}),
  auditDetail:(id:string)=>rpc('escala_audit_detail',{p_unit:session().unit,p_id:id}),
 };
}
export function escalaError(error:unknown):string{
 const e=error as {message?:string;details?:string};const message=String(e?.message||error||'Falha na operação.');
 if(message.includes('ESCALA_APPROVAL_CONFLICT')&&e.details){try{const issues=JSON.parse(e.details) as {message:string}[];return 'Revise as pendências antes de aprovar: '+issues.slice(0,4).map(i=>i.message).join(' ');}catch{/* Use the readable default below. */}}
 const extra:Record<string,string>={ESCALA_FIXED_TEAM_SCHEDULE:'Equipes preservadas trabalham de segunda a sexta e folgam aos sábados e domingos. Use Sortear novas folgas para atualizar o rascunho.',ESCALA_COMPOSITION_LOCKED:'A composição está protegida por uma escala aprovada, dia bloqueado ou rota realizada.',ESCALA_COMPOSITION_TEAMS:'As equipes definidas mudaram. Atualize e gere outra prévia.',ESCALA_COMPOSITION_ROLE:'Cada equipe sorteada precisa de 1 motorista e da quantidade de ajudantes escolhida.',ESCALA_COMPOSITION_PERSON:'Um colaborador não está mais disponível para este mês. Atualize os dados e gere outra prévia.',ESCALA_COMPOSITION_INVALID:'Revise o mês, a área e a quantidade de ajudantes do sorteio.',ESCALA_OPENING_INVALID:'Revise os dias anteriores ao mês e confirme as informações do saldo inicial.',ESCALA_COMPOSE_FIRST:'Vincule os integrantes às equipes antes de informar o saldo inicial.',ESCALA_APPROVED_HISTORY_EXISTS:'Já existe uma escala aprovada para esse período. Use o histórico salvo; somente o administrador pode desbloqueá-lo para correções.',ESCALA_NOT_FOUND:'O cadastro não está mais disponível nesta unidade.',ESCALA_5X2_LIMIT:'No regime 5x2, configure no máximo cinco dias trabalhados por semana e cinco dias consecutivos.'};for(const [code,text]of Object.entries(extra))if(message.includes(code))return text;
 const names:Record<string,string>={STAFF_USE_DIRECTORY:'Cadastre a pessoa em Configurações → Cadastro de Equipes e depois vincule à Escala.',STAFF_PERSON_INVALID:'Escolha uma pessoa ativa do Cadastro de Equipes desta unidade.',STAFF_PERSON_INACTIVE:'A pessoa está inativa no Cadastro de Equipes. Reative o cadastro antes de alterar sua situação na Escala.',FORBIDDEN:'Você não tem permissão para essa ação nesta unidade.',ESCALA_VERSION_CONFLICT:'Outra pessoa alterou este registro. Atualize antes de salvar. Seu rascunho foi preservado.',ESCALA_DUPLICATE_MEMBERSHIP:'Este funcionário já participa de uma equipe ativa nesse período. Faça a transferência ou informe uma autorização administrativa.',ESCALA_LOCKED:'A escala está aprovada ou bloqueada. Somente o administrador pode desbloqueá-la.',ESCALA_DAY_LOCKED:'Há uma folga bloqueada nessa data. Somente o administrador pode alterar com justificativa.',ESCALA_APPROVAL_CONFLICT:'A escala tem pendências que precisam ser resolvidas antes da aprovação.',ESCALA_REASON_REQUIRED:'Informe a justificativa da alteração.',ESCALA_REQUIRED_ROUTES:'A alteração reduziria a necessidade de rotas definida nas configurações.',ESCALA_PROFILE_UNIT_INVALID:'O usuário selecionado não pertence a esta unidade.',ESCALA_AUTOMATIC_HOLIDAY:'Feriados automáticos podem ser ajustados, mas não excluídos.',ESCALA_TRANSFER_DATE:'A transferência deve ocorrer depois do início do vínculo e dentro de seu período.',ESCALA_FUTURE_COMPLETION:'Uma rota futura não pode ser marcada como realizada.'};
 for(const [code,text]of Object.entries(names))if(message.includes(code))return text;
 if(/42P01|PGRST202|escala_.*schema cache|does not exist/.test(message))return 'A atualização do banco do módulo Escala ainda não foi aplicada.';
 if(/Failed to fetch|Network|fetch failed/i.test(message))return 'Sem conexão com o servidor. O rascunho foi preservado neste aparelho.';
 if(/check constraint|23514|invalid input|2200|not-null|23502/.test(message))return 'Revise os campos obrigatórios, os períodos e os limites informados.';
 if(/unique constraint|23505/.test(message))return 'Já existe um cadastro com essa identificação. Edite o registro existente.';
 return message;
}
