/** Discovery is a small catalog; schemas are fetched only for one named tool. */
export function discoverReadTools(value:unknown,allowed:ReadonlySet<string>,requested?:string){
  if(requested&&!allowed.has(requested))throw new Error('Выберите разрешённый инструмент чтения из list_tools.');
  const tools=(value as {tools?:unknown})?.tools;if(!Array.isArray(tools))throw new Error('MCP не вернул каталог инструментов.');
  const visible=[...new Map(tools.filter((tool):tool is {name:string;description?:string;[key:string]:unknown}=>!!tool&&typeof tool==='object'&&typeof tool.name==='string'&&allowed.has(tool.name)).map(tool=>[tool.name,tool])).values()];
  if(requested){const selected=visible.find(tool=>tool.name===requested);if(!selected)throw new Error(`Инструмент ${JSON.stringify(requested)} недоступен в этой версии MCP. Выберите имя из list_tools.`);return {tools:[selected]};}
  return {tools:visible.map(tool=>({name:tool.name,...(typeof tool.description==='string'?{description:tool.description.replace(/\s+/g,' ').slice(0,120)}:{})})),hint:'Для полной схемы вызовите operation=list_tools, tool=<имя>. Затем operation=call, tool=<имя>, arguments={...}.'};
}
