import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

import controllers from '../../controllers';
import deviceController from '../../controllers/devices';
import { isAuthenticated } from '../../middlewares/authentication';

// TODO Remove this, pending on removing all auth logic from routes

// /api/useradmin
const router = express.Router();

router.use(cookieParser());

function runAsyncWrapper(callback) {
  return function wrapper(req, res, next) {
    callback(req, res, next)
      .catch(next);
  };
}

let models;

// FIXME: already provided in auth.js
router.post('/auth', bodyParser.urlencoded({ extended: true }), runAsyncWrapper(async (req, res) => {
  const signIn = await controllers.authentication.signIn(req.body.email, req.body.password);
  if (!signIn.success) {
    return res.redirect(`/useradmin?status=${encodeURIComponent('Invalid credentials or banned account')}`);
  }

  return res.cookie('jwt', signIn.jwt).redirect('/useradmin/overview');
}));

// FIXME: already provided in auth.js
router.get('/signout', runAsyncWrapper(async (req, res) => {
  res.clearCookie('session');
  return res.json({ success: true });
}));

router.get('/', runAsyncWrapper(async (req, res) => {
  // TODO pull these values from db
  const accounts = 0;
  const devices = 0;
  const drives = 0;

  return res.status(200).send({
    success: true,
    data: {
      serverStats: {
        config: {
          registerAllowed: process.env.ALLOW_REGISTRATION,
          welcomeMessage: process.env.WELCOME_MESSAGE,
        },
        accounts: accounts.num,
        devices: devices.num,
        drives: drives.num,
        storageUsed: await controllers.storage.getTotalStorageUsed(),
      },
    },
  });
}));

router.get('/overview', isAuthenticated, runAsyncWrapper(async (req, res) => {
  const { account } = req;
  const devices = await deviceController.getDevices(account.id);

  // TODO implement a _safe_ get account for these use cases to allow for data to be stripped prior to sending to the client.
  delete (account.email_verify_token);
  return res.status(200).json({
    success: true,
    data: {
      account,
      devices,
    },
  });
}));

router.get('/unpair_device/:dongleId', isAuthenticated, runAsyncWrapper(async (req, res) => {
  const { account, params: { dongleId } } = req;

  const device = await deviceController.getDeviceFromDongleId(dongleId);
  if (!device) {
    return res.status(404).json({ success: false, msg: 'NOT_FOUND' });
  } else if (device.accountId !== account.id) {
    return res.status(403).json({ success: false, msg: 'FORBIDDEN' });
  }

  const result = await deviceController.unpairDevice(dongleId, account.id);
  if (!result.success) {
    return res.status(500).json(result);
  }

  return res.status(200).json({ success: true });
}));

router.post('/pair_device', [isAuthenticated, bodyParser.urlencoded({ extended: true })], runAsyncWrapper(async (req, res) => {
  const { account, body: { qrString } } = req;
  if (!qrString) {
    return res.json({ success: false, msg: 'BAD_REQUEST', status: 400 });
  }

  const pairDevice = await controllers.devices.pairDevice(account, qrString);
  if (!pairDevice.success) {
    return res.json({ success: false, msg: 'error', data: pairDevice });
  }

  return res.json({
    success: true,
    msg: 'Paired',
    status: 200,
    data: pairDevice,
  });
}));

router.post('/password/change', [isAuthenticated, bodyParser.urlencoded({ extended: true })], runAsyncWrapper(async (req, res) => {
  const { account, body: { oldPassword, newPassword } } = req;
  const result = await controllers.authentication.changePassword(
    account,
    newPassword,
    oldPassword,
  );
  if (!result.success) {
    return res.status(result.status).json(result);
  }

  return res.json({ success: true });
}));

export default router;
