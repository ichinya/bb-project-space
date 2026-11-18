import { experimental_Icon as Icon,UrlLink,type PluginMessageDirectiveProps } from '@get-bb/plugin-sdk/app';
import { pagePreviewTarget } from './page-preview.ts';
import './page-preview.css';

export function PagePreview({attributes}:PluginMessageDirectiveProps){
  const target=pagePreviewTarget(attributes);
  if(!target)return <div className="ps-page-preview ps-page-preview-unavailable" role="note"><Icon name="FileText" aria-hidden/><div><strong>Страница недоступна</strong><span>В сообщении указан некорректный идентификатор страницы.</span></div></div>;
  return <UrlLink href={target.url} target="_blank" rel="noopener noreferrer" className="ps-page-preview" title={target.url}>
    <span className="ps-page-preview-icon"><Icon name="FileText" aria-hidden/></span>
    <span className="ps-page-preview-body"><strong>{target.title}</strong><span>Открыть в ChatGPT · может потребоваться вход</span></span>
    <span className="ps-page-preview-open">Открыть <Icon name="ArrowUpRight" aria-hidden/></span>
  </UrlLink>;
}
