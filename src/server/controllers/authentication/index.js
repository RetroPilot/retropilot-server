import crypto from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import log4js from 'log4js';

import { Accounts } from '../../../models';

const logger = log4js.getLogger('default');

export async function validateJWT(token, key) {
  try {
    return jsonwebtoken.verify(token.replace('JWT ', ''), key, { algorithms: ['RS256'], ignoreNotBefore: true });
  } catch (exception) {
    logger.warn(`failed to validate JWT ${exception}`);
  }
  return null;
}

export async function readJWT(token) {
  try {
    return jsonwebtoken.decode(token);
  } catch (exception) {
    logger.warn(`failed to read JWT ${exception}`);
  }
  return null;
}

async function signIn(email, password) {
  let account = await Accounts.findOne({ where: { email } });

  if (!account || !account.dataValues) {
    return { success: false, msg: 'BAD ACCOUNT' };
  }

  account = account.dataValues;
  const inputPassword = crypto.createHash('sha256').update(password + process.env.APP_SALT).digest('hex');
  if (account.password !== inputPassword) {
    return { success: false, msg: 'BAD PASSWORD' };
  }

  const token = jsonwebtoken.sign({ accountId: account.id }, process.env.APP_SALT);
  return { success: true, jwt: token };
}

async function changePassword(account, newPassword, oldPassword) {
  if (!account || !newPassword || !oldPassword) {
    return { success: false, error: 'MISSING_DATA' };
  }

  const oldPasswordHash = crypto.createHash('sha256').update(oldPassword + process.env.APP_SALT).digest('hex');
  if (account.password !== oldPasswordHash) {
    return { success: false, msg: 'BAD PASSWORD', passwordCorrect: false };
  }

  const newPasswordHash = crypto.createHash('sha256').update(newPassword + process.env.APP_SALT).digest('hex');

  await Accounts.update(
    { password: newPasswordHash },
    { where: { id: account.id } },
  );

  return { success: true, msg: 'PASSWORD CHANGED', changed: true };
}

/*
 TODO: update rest of the code to support authentication rejection reasons
*/

async function getAuthenticatedAccount(req) {
  const sessionJWT = req.cookies.jwt;
  if ((!sessionJWT || sessionJWT.expires <= Date.now())) {
    return null;
  }

  return getAccountFromJWT(sessionJWT);
}

async function getAccountFromJWT(jwt, limitData = true) {
  let token;

  try {
    token = jsonwebtoken.verify(jwt, process.env.APP_SALT);
  } catch (err) {
    return null;// {success: false, msg: 'BAD_JWT'}
  }

  if (!token || !token.accountId) {
    return null; // {success: false, badToken: true}
  }

  let query = { where: { id: token.accountId } };
  if (limitData) {
    // we don't want to include sensitive info in the response
    query = {
      ...query,
      attributes: { exclude: ['password', '2fa_token', 'session_seed'] },
    };
  }

  const account = await Accounts.findOne(query);
  if (!account || !account.dataValues) {
    return null; // {success: false, isInvalid: true}
  }

  try {
    await Accounts.update(
      { last_ping: Date.now() },
      { where: { id: account.id } },
    );
  } catch (error) {
    console.log(error);
  }

  if (!account || account.banned) {
    return null; // {success: false, isBanned: true}
  }
  return account;
}

export default {
  validateJWT,
  getAuthenticatedAccount,
  changePassword,
  signIn,
  readJWT,
  getAccountFromJWT,
};
