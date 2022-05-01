import { Accounts } from '../../../models';

export async function SetResearchStatus(userId, status) {
  if (typeof (status) !== 'boolean') { return { success: false, notBoolean: true }; }

  Accounts.update({ research_enabled: status }, { where: { id: userId } });
}

export async function GetResearchStatus(userId) {
  return Accounts.findOne({ where: { id: userId }, attributes: ['research_enabled'] });
}

export default null;
