import { generateSecret, verify } from '2fa-util';

import { Accounts } from '../../../models';
import {
  AUTH_2FA_BAD_ACCOUNT,
  AUTH_2FA_ONBOARD_ALREADY_ENROLLED,
  AUTH_2FA_NOT_ENROLLED,
  AUTH_2FA_ENROLLED,
  AUTH_2FA_BAD_TOKEN,
} from '../../consistency/terms';

export async function twoFactorOnboard(account) {
  if (!account || !account.dataValues) { return { success: false, ...AUTH_2FA_BAD_ACCOUNT }; }
  if (account['2fa_token'] !== null) return { success: false, ...AUTH_2FA_ONBOARD_ALREADY_ENROLLED };

  const token = await generateSecret(account.email, process.env.AUTH_2FA_ISSUER);

  await Accounts.update(
    { '2fa_token': token.secret },
    { id: account.id },
  );

  return token;
}

export async function twoFactorConfirm(account, token) {
  const isTokenValid = await verifyTwoFactor(account.id, token);
  if (!isTokenValid) {
    return { success: false, ...AUTH_2FA_BAD_TOKEN };
  }

  await Accounts.update(
    { two_factor_enabled: true },
    { id: account.id },
  );
  return { success: true, ...AUTH_2FA_ENROLLED };
}

export async function verifyTwoFactor(account, token) {
  if (!account || !account.dataValues) {
    return { success: false, ...AUTH_2FA_BAD_ACCOUNT };
  }
  if (!account['2fa_token']) {
    return { success: false, ...AUTH_2FA_NOT_ENROLLED };
  }

  return verify(token, account['2fa_token']).catch(console.log);
}

export default null;
