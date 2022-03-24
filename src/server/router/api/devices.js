import bodyParser from 'body-parser';
import crypto from 'crypto';
import dirTree from 'directory-tree';
import express from 'express';
import log4js from 'log4js';

import { requireAuthenticated } from '../../middlewares/authentication';
import deviceController from '../../controllers/devices';
import { MutateDevice } from '../../schema/routes/devices';

const logger = log4js.getLogger();

// /api/devices
const router = express.Router();

router.get('/', requireAuthenticated, async (req, res) => {
  const { account: { id } } = req;
  const devices = await deviceController.getDevices(id);

  return res.json({ success: true, data: devices });
});

/*
{
  version: "1.0"
  2fa: {
    tokenProvided: false,
    token: 000000
    unixTime: 00000
  },
  modifications: {
    nicname: x
    publicKey: x
  }
}
*/

router.put('/:dongleId', [requireAuthenticated, bodyParser.json()], async (req, res) => {
  const { body } = req;
  logger.info(MutateDevice.isValid(body));
  // TODO: response?
  return res.json({ success: true });
});

router.get('/:dongleId/drives/:driveIdentifier/segment', requireAuthenticated, async (req, res) => {
  const {
    account: { id: accountId },
    params: {
      dongleId,
      driveIdentifier,
    },
  } = req;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);

  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }
  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
    .update(dongleId)
    .digest('hex');
  const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
    .update(driveIdentifier)
    .digest('hex');

  const directoryTree = dirTree(`${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/${driveIdentifierHash}/${driveIdentifier}`);
  return res.json({ success: true, msg: 'ok', data: directoryTree });
});

router.get('/:dongleId/drives', requireAuthenticated, async (req, res) => {
  const { dongleId } = req.params;
  const { deleted } = req.query;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);

  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const drives = await deviceController.getDrives(dongleId, deleted === 'true', true);
  return res.json({ success: true, data: drives });
});

router.get('/:dongleId/bootlogs', requireAuthenticated, async (req, res) => {
  const { dongleId } = req.params;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);
  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const bootlogs = await deviceController.getBootlogs(dongleId);
  return res.json({ success: true, data: bootlogs });
});

router.get('/:dongleId/crashlogs', requireAuthenticated, async (req, res) => {
  const { dongleId } = req.params;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);
  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const crashlogs = await deviceController.getCrashlogs(dongleId);
  return res.json({ success: true, data: crashlogs });
});

export default router;
