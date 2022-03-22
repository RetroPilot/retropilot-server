import bodyParser from 'body-parser';
import crypto from 'crypto';
import dirTree from 'directory-tree';
import express from 'express';
import log4js from 'log4js';

import { isAuthenticated } from '../../middlewares/authentication';
import deviceController from '../../controllers/devices';
import { MutateDevice } from '../../schema/routes/devices';

const logger = log4js.getLogger('default');

// /api/devices
const router = express.Router();

router.get('/', isAuthenticated, async (req, res) => {
  const dongles = await deviceController.getDevices(req.account.id);

  return res.json({ success: true, data: dongles });
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

router.put('/:dongle_id/', [isAuthenticated, bodyParser.json()], async (req, res) => {
  const { body } = req;
  logger.info(MutateDevice.isValid(body));
  // TODO: response?
  return res.json({ success: true });
});

router.get('/:dongle_id/drives/:drive_identifier/segment', isAuthenticated, async (req, res) => {
  const dongleId = req.params.dongle_id;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);

  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }
  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT).update(req.params.dongle_id).digest('hex');
  const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT).update(req.params.drive_identifier).digest('hex');

  const directoryTree = dirTree(`${process.env.STORAGE_PATH + req.params.dongle_id}/${dongleIdHash}/${driveIdentifierHash}/${req.params.drive_identifier}`);

  return res.json({ success: true, msg: 'ok', data: directoryTree });
});

router.get('/:dongle_id/drives/:deleted', isAuthenticated, async (req, res) => {
  const dongleId = req.params.dongle_id;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);

  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const dongles = await deviceController.getDrives(req.params.dongle_id, req.params.deleted === 'true', true);

  return res.json({ success: true, data: dongles });
});

router.get('/:dongle_id/bootlogs', isAuthenticated, async (req, res) => {
  const dongleId = req.params.dongle_id;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);
  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const bootlogs = await deviceController.getBootlogs(req.params.dongle_id);

  return res.json({ success: true, data: bootlogs });
});

router.get('/:dongle_id/crashlogs', isAuthenticated, async (req, res) => {
  const dongleId = req.params.dongle_id;
  const accountId = req.account.id;
  const isUserAuthorised = await deviceController.isUserAuthorised(dongleId, accountId);
  // TODO reduce data returned
  if (isUserAuthorised.success === false || isUserAuthorised.data.authorised === false) {
    return res.json({ success: false, msg: isUserAuthorised.msg });
  }

  const crashlogs = await deviceController.getCrashlogs(req.params.dongle_id);

  return res.json({ success: true, data: crashlogs });
});

export default router;
