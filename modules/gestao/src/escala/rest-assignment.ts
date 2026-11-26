type Edge={to:number;reverse:number;capacity:number;cost:number};
export type RestChoice={id:string;days:{day:number;cost:number}[]};
// Each person receives one day. Weekday capacities and a fixed Saturday
// capacity make coverage a hard constraint; costs only decide fairness.
export function assignRest(people:RestChoice[],capacities:number[]){
 const count=people.length,source=0,firstPerson=1,firstDay=firstPerson+count,sink=firstDay+6,graph:Edge[][]=Array.from({length:sink+1},()=>[]);
 const add=(from:number,to:number,capacity:number,cost:number)=>{const edge={to,reverse:graph[to].length,capacity,cost};graph[from].push(edge);graph[to].push({to:from,reverse:graph[from].length-1,capacity:0,cost:-cost});return edge;};
 const choices:Map<number,Edge>[]=[];
 people.forEach((p,i)=>{add(source,firstPerson+i,1,0);const map=new Map<number,Edge>();for(const d of p.days)map.set(d.day,add(firstPerson+i,firstDay+d.day-1,1,d.cost));choices.push(map);});
 capacities.forEach((capacity,i)=>add(firstDay+i,sink,Math.max(0,capacity),0));let flow=0;
 for(;;){const distance=Array(graph.length).fill(Infinity),previous:Array<[number,number]|null>=Array(graph.length).fill(null);distance[source]=0;
  for(let pass=0;pass<graph.length-1;pass++){let changed=false;for(let node=0;node<graph.length;node++)if(Number.isFinite(distance[node]))for(let n=0;n<graph[node].length;n++){const edge=graph[node][n];if(edge.capacity>0&&distance[edge.to]>distance[node]+edge.cost){distance[edge.to]=distance[node]+edge.cost;previous[edge.to]=[node,n];changed=true;}}if(!changed)break;}
  if(!previous[sink])break;for(let node=sink;node!==source;){const [parent,index]=previous[node]!;const edge=graph[parent][index];edge.capacity--;graph[node][edge.reverse].capacity++;node=parent;}flow++;
 }
 return {flow,assignments:new Map(people.flatMap((p,i)=>[...choices[i]].filter(([,edge])=>edge.capacity===0).map(([day])=>[p.id,day] as const)))};
}
