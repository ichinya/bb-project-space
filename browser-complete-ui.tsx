import { experimental_Icon as Icon, type PluginMessageDirectiveProps } from '@get-bb/plugin-sdk/app';

export function BrowserComplete({ attributes, source }: PluginMessageDirectiveProps) {
  const title = attributes.title?.trim();
  if (!title) return <>{source}</>;

  return (
    <div className="ps-browser-complete" role="note">
      <Icon name="Globe" aria-hidden />
      <span>{title}</span>
    </div>
  );
}
