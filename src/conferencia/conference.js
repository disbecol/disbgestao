(() => {
  'use strict';

  const types = [
    {key:'g300',label:'Garrafeiras de 300ml',unitsPerCrate:23,value:69.5,bottleValue:1.5},
    {key:'g600_green',label:'Garrafeiras 600ml Verde',unitsPerCrate:24,value:83,bottleValue:2},
    {key:'g600_brown',label:'Garrafeiras 600ml Marrom',unitsPerCrate:24,value:71,bottleValue:1.5},
    {key:'g_litrao',label:'Garrafeiras de Litrão',unitsPerCrate:12,value:59,bottleValue:1.5},
    {key:'keg30',label:'Barris de Chopp 30L',unitsPerCrate:0,value:400},
    {key:'keg50',label:'Barris de Chopp 50L',unitsPerCrate:0,value:400},
    {key:'chapatex',label:'Chapatex',unitsPerCrate:0,value:8},
    {key:'pbr1',label:'PBR 1',unitsPerCrate:0,value:45},
    {key:'pbr2',label:'PBR 2',unitsPerCrate:0,value:45},
  ];
  const typeByKey = new Map(types.map(type=>[type.key,type]));
  const count = value => Math.max(0, Number(value)||0);
  const mapNumbers = conference => (Array.isArray(conference?.map_numbers)&&conference.map_numbers.length?conference.map_numbers:[conference?.map_number,conference?.second_map_number]).filter(Boolean).map(String);
  const sales = conference => Array.isArray(conference?.sales) ? conference.sales : [];

  function saleTotals(conference,key){
    const type=typeByKey.get(key);
    const result={containers:0,bottles:0,complete:0,looseBottles:0};
    for(const sale of sales(conference)){
      if(sale.type!==key)continue;
      const quantity=count(sale.quantity);
      if(sale.mode==='crate')result.containers+=quantity;
      if(sale.mode==='bottle'){
        result.bottles+=quantity;
        result.looseBottles+=quantity;
      }
      if(sale.mode==='both'){
        result.containers+=quantity;
        result.complete+=quantity;
        result.bottles+=quantity*(type?.unitsPerCrate||0);
      }
      if(sale.mode==='item')result.containers+=quantity;
    }
    return result;
  }

  function bottlesFromCrates(conference){
    const gross=types.reduce((total,type)=>total+(type.unitsPerCrate?count(conference?.[type.key])*type.unitsPerCrate:0),0);
    const looseSales=types.reduce((total,type)=>total+saleTotals(conference,type.key).looseBottles,0);
    const emptyCrateBottles=types.reduce((total,type)=>{const sold=saleTotals(conference,type.key);return total+(sold.containers-sold.complete)*type.unitsPerCrate;},0);
    return {gross,emptyCrateBottles,looseSales,estimated:gross+emptyCrateBottles-looseSales};
  }

  function aggregateMaps(rows,conference){
    const numbers=mapNumbers(conference);
    const maps=numbers.map(number=>rows.find(row=>String(row.map_number)===number)).filter(Boolean);
    if(maps.length!==numbers.length)return {maps,complete:false,missing:numbers.filter(number=>!maps.some(map=>String(map.map_number)===number))};
    const total={map_number:numbers.join(' + '),map_date:maps.map(map=>String(map.map_date||'')).sort()[0]||'',city:maps.map(map=>map.city).filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index).join(' / '),driver:maps.map(map=>map.driver).filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index).join(' / '),helper1:maps.map(map=>map.helper1).filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index).join(' / '),helper2:maps.map(map=>map.helper2).filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index).join(' / ')};
    for(const type of types){
      total[type.key]=maps.some(map=>map[type.key]==null)?null:maps.reduce((sum,map)=>sum+count(map[type.key]),0);
    }
    return {maps,complete:true,total};
  }

  function compare(rows,conference){
    const combined=aggregateMaps(rows,conference);
    const diffs={};let pos=0,neg=0,divCount=0;
    for(const type of types){
      const plan=combined.complete?combined.total[type.key]:null;
      const actual=count(conference?.[type.key]);
      const sold=saleTotals(conference,type.key);
      const expected=plan==null?null:plan-sold.containers;
      const diff=expected==null?null:actual-expected;
      const planBottles=plan==null||!type.unitsPerCrate?null:plan*type.unitsPerCrate;
      const expectedBottles=planBottles==null?null:planBottles-sold.bottles;
      // O conferente informa garrafeiras, sem contar garrafas avulsas à parte.
      // Garrafeira vendida vazia conserva as garrafas no saldo estimado; venda
      // completa retira ambos e venda avulsa retira só as garrafas.
      const actualBottles=!type.unitsPerCrate?null:actual*type.unitsPerCrate+(sold.containers-sold.complete)*type.unitsPerCrate-sold.looseBottles;
      const diffUnits=expectedBottles==null?null:actualBottles-expectedBottles;
      const containerValue=diff==null||type.value==null?null:Math.abs(diff)*type.value;
      const bottleValue=diffUnits==null||type.bottleValue==null?null:Math.abs(diffUnits)*type.bottleValue;
      const value=containerValue==null?null:containerValue+(bottleValue||0);
      const checkedValue=type.value==null?null:actual*type.value;
      diffs[type.key]={...type,plan,planBottles,actual,sold,expected,diff,expectedBottles,actualBottles,diffUnits,containerValue,bottleValue,value,checkedValue};
      if(diff!=null&&(diff!==0||diffUnits!==null&&diffUnits!==0)){
        divCount++;
        if(containerValue!=null){if(diff>0)pos+=containerValue;else if(diff<0)neg+=containerValue;}
        if(bottleValue!=null){if(diffUnits>0)pos+=bottleValue;else if(diffUnits<0)neg+=bottleValue;}
      }
    }
    return {...combined,diffs,pos,neg,divCount,status:!combined.complete?'SEM_BASE':divCount?'DIVERGENTE':'OK'};
  }

  const api={types,mapNumbers,saleTotals,bottlesFromCrates,aggregateMaps,compare};
  if(typeof window!=='undefined')window.DISB_CONFERENCE=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
