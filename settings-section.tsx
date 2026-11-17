import { useState,type ReactNode } from 'react';

export function SettingsSection({title,summary,children,defaultOpen=false,className=''}:{title:string;summary?:ReactNode;children:ReactNode;defaultOpen?:boolean;className?:string}){
  const [open,setOpen]=useState(defaultOpen);
  return <details className={`ps-settings-section ${className}`} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><span className="ps-settings-heading"><strong>{title}</strong>{summary&&<span className="ps-muted">{summary}</span>}</span></summary>
    <div className="ps-settings-content">{children}</div>
  </details>;
}

export function SettingsError({message}:{message:string}){
  const lines=message.trim().split(/\r?\n/),verbose=message.length>500||lines.length>4;
  const concise=verbose?(lines.filter(line=>line.trim()).at(-1)??'Операция не выполнена.').slice(0,500):message;
  return <div role="alert" className="ps-error"><p>{concise}</p>{verbose&&<details className="ps-error-details"><summary>Подробности ошибки</summary><pre>{message}</pre></details>}</div>;
}
