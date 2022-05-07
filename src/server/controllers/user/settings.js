import * as yup from 'yup';
import { Accounts } from '../../../models';

const settingsSchema = yup.object().shape({
  email: yup.string().email(),
  forkMaintainerShare: yup.bool(),
  acceptUploads: yup.bool(),
  marketingConsent: yup.bool(),
}).noUnknown(true)
  .required()
  .strict();

export async function SetResearchStatus(userId, status) {
  if (typeof (status) !== 'boolean') { return { success: false, notBoolean: true }; }

  Accounts.update({ research_enabled: status }, { where: { id: userId } });
}

export async function GetResearchStatus(userId) {
  return Accounts.findOne({ where: { id: userId }, attributes: ['research_enabled'] });
}

export async function GetUserSettings(userId) {
  return Accounts.findOne({ where: { id: userId }, attributes: ['settings'] });
}

export async function SetUserSettings(userId, settings) {
  console.log(userId, settings);
  const settingsValid = await settingsSchema.isValid(settings).catch((err) => {
    return {
      success: false, error: true, schemaValidationFailed: true, err,
    };
  });

  if (settingsValid) {
    Accounts.update({ settings: JSON.stringify(settings) }, { where: { id: userId } });
    return { success: true };
  }
  return { success: false, invalidInput: true };
}

export default null;
