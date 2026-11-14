import type { NewThreadRequest } from '@get-bb/plugin-sdk/app';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk';

/** Read the machine chosen by BB's composer without reinterpreting provider inputs. */
export async function launchHostId(choice:NewThreadRequest['environment'],sdk:Pick<PluginBrowserBbSdk,'environments'>):Promise<string> {
  if(choice.type==='reuse')return (await sdk.environments.get({environmentId:choice.environmentId})).hostId;
  if(choice.type==='host'&&choice.hostId)return choice.hostId;
  if(choice.type==='provider'&&choice.machine?.type==='existing')return choice.machine.hostId;
  if(choice.type==='provider'&&choice.machine?.type==='new')throw new Error('Для пространства выберите существующее устройство, на котором доступны папки проектов.');
  throw new Error('Не удалось определить устройство рабочей среды. Выберите устройство в композере.');
}
