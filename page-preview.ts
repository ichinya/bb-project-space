export type PagePreviewTarget={url:string;title:string;pageId:string};

/** Pages' canonical HTTPS route (also returned in read_page metadata.url).
 * Accept opaque Page IDs only, never arbitrary paths or URL schemes. */
export function pagePreviewTarget(attributes:Readonly<Record<string,string>>):PagePreviewTarget|null{
  const pageId=attributes.page_id;
  if(typeof pageId!=='string'||!/^page_[a-f0-9]{32}$/.test(pageId))return null;
  const url=`https://chatgpt.com/space/${pageId}`;
  const title=typeof attributes.title==='string'?attributes.title.trim().slice(0,240):'';
  return {pageId,url,title:title||'Страница ChatGPT'};
}
