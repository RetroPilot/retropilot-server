import bodyParser from 'body-parser';
import crypto from 'crypto';
import express from 'express';
import log4js from 'log4js';

import { validateJWT } from '../controllers/authentication';
import deviceController from '../controllers/devices';
import storageController from '../controllers/storage';
import { getAccountFromId } from '../controllers/users';

const logger = log4js.getLogger();
const router = express.Router();

function runAsyncWrapper(callback) {
  return function wrapper(req, res, next) {
    callback(req, res, next)
      .catch(next);
  };
}

// TODO(cameron): clean up this mess into separate files

// DRIVE & BOOT/CRASH LOG FILE UPLOAD HANDLING
router.put('/backend/post_upload', bodyParser.raw({
  inflate: true,
  limit: '100000kb',
  type: '*/*',
}), runAsyncWrapper(async (req, res) => {
  const buf = Buffer.from(req.body.toString('binary'), 'binary');
  logger.info(`HTTP.PUT /backend/post_upload for dongle ${req.query.dongleId} with body length: ${buf.length}`);

  const {
    dir: directory,
    dongleId,
    file: filename,
    ts,
  } = req.query;

  const isDriveFile = filename.indexOf('boot') !== 0 && filename.indexOf('crash') !== 0;
  if (isDriveFile) {
    logger.info(`HTTP.PUT /backend/post_upload DRIVE upload with filename: ${filename}, directory: ${directory}, token: ${req.query.token}`);
  } else {
    logger.info(`HTTP.PUT /backend/post_upload BOOT or CRASH upload with filename: ${filename}, token: ${req.query.token}`);
  }

  const token = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId + filename + directory + ts).digest('hex');
  if (token !== req.query.token) {
    logger.error(`HTTP.PUT /backend/post_upload token mismatch (${token} vs ${req.query.token})`);
    return res.status(400).send('Malformed request');
  }

  logger.info('HTTP.PUT /backend/post_upload permissions checked, calling moveUploadedFile');
  const moveResult = storageController.moveUploadedFile(buf, directory, filename);
  if (!moveResult) {
    logger.error('HTTP.PUT /backend/post_upload moveUploadedFile failed');
    return res.status(500).send('Internal Server Error');
  }

  logger.info(`HTTP.PUT /backend/post_upload successfully uploaded to ${moveResult}`);
  return res.status(200).json(['OK']);
}));

// RETURN THE PAIRING STATUS
router.get('/v1.1/devices/:dongleId/', runAsyncWrapper(async (req, res) => {
  const { authorization } = req.headers;
  const { dongleId } = req.params;
  logger.info(`HTTP.DEVICES called for ${dongleId}`);

  const device = await deviceController.getDeviceFromDongleId(dongleId);
  if (!device) {
    logger.info(`HTTP.DEVICES device ${dongleId} not found`);
    return res.status(200).json({
      is_paired: false,
      prime: false,
      prime_type: 0,
    });
  }

  const {
    account_id: accountId,
    public_key: publicKey,
  } = device;

  const decoded = publicKey
    ? await validateJWT(authorization, publicKey)
    : null;

  if ((!decoded || decoded.identity !== dongleId)) {
    logger.info('HTTP.DEVICES JWT authorization failed', {
      token: authorization,
      device,
      decoded,
    });
    return res.status(401).send('Unauthorized.');
  }

  const PrimeType = {
    None: 0,
    Magenta: 1,
    Lite: 2,
  };

  const isPaired = accountId !== 0;
  const response = {
    is_paired: isPaired,
    /*
     * Whether the account is subscribed to prime. Removed in OP 0.8.13. Replaced by `prime_type`.
     */
    prime: isPaired,
    /*
     * The type of prime subscription the account is subscribed to.
     */
    prime_type: isPaired ? PrimeType.Lite : PrimeType.None,
  };
  logger.info(`HTTP.DEVICES for ${dongleId} returning: ${JSON.stringify(response)}`);

  return res.status(200).json(response);
}));

// RETURN STATS FOR DASHBOARD
router.get('/v1.1/devices/:dongleId/stats', runAsyncWrapper(async (req, res) => {
  const { dongleId } = req.params;
  logger.info(`HTTP.STATS called for ${dongleId}`);

  const stats = {
    all: {
      routes: 0,
      distance: 0,
      minutes: 0,
    },
    week: {
      routes: 0,
      distance: 0,
      minutes: 0,
    },
  };

  const device = await deviceController.getDeviceFromDongleId(dongleId);
  if (!device) {
    logger.info(`HTTP.STATS device ${dongleId} not found`);
    return res.status(404).json('Not found.');
  }

  const { public_key: publicKey } = device;
  const { authorization } = req.headers;
  const decoded = device.public_key
    ? await validateJWT(authorization, publicKey)
    : null;

  if ((!decoded || decoded.identity !== dongleId)) {
    logger.info(`HTTP.STATS JWT authorization failed, token: ${authorization} device: ${JSON.stringify(device)}, decoded: ${JSON.stringify(decoded)}`);
    return res.status(401).send('Unauthorized.');
  }

  // TODO reimplement weekly stats
  // const statresult = await models.get('SELECT COUNT(*) as routes, ROUND(SUM(distance_meters)/1609.34) as distance, ROUND(SUM(duration)/60) as duration FROM drives WHERE dongle_id=?', device.dongle_id);
  // if (statresult != null && statresult.routes != null) {
  //   stats.all.routes = statresult.routes;
  //   stats.all.distance = statresult.distance != null ? statresult.distance : 0;
  //   stats.all.minutes = statresult.duration != null ? statresult.duration : 0;
  // }
  //
  // // this determines the date at 00:00:00 UTC of last monday (== beginning of the current "ISO"week)
  // const d = new Date();
  // const day = d.getDay();
  // const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  // const lastMonday = new Date(d.setDate(diff));
  // lastMonday.setHours(0, 0, 0, 0);
  //
  // const statresultweek = await models.get('SELECT COUNT(*) as routes, ROUND(SUM(distance_meters)/1609.34) as distance, ROUND(SUM(duration)/60) as duration FROM drives WHERE dongle_id=? AND drive_date >= ?', device.dongle_id, lastMonday.getTime());
  // if (statresultweek != null && statresultweek.routes != null) {
  //   stats.week.routes = statresultweek.routes;
  //   stats.week.distance = statresultweek.distance != null ? statresultweek.distance : 0;
  //   stats.week.minutes = statresultweek.duration != null ? statresultweek.duration : 0;
  // }

  logger.info(`HTTP.STATS for ${dongleId} returning: ${JSON.stringify(stats)}`);
  return res.status(200).json(stats);
}));

// RETURN USERNAME & POINTS FOR DASHBOARD
router.get('/v1/devices/:dongleId/owner', runAsyncWrapper(async (req, res) => {
  const { dongleId } = req.params;
  logger.info(`HTTP.OWNER called for ${dongleId}`);

  const device = await deviceController.getDeviceFromDongleId(dongleId);

  if (!device) {
    logger.info(`HTTP.OWNER device ${dongleId} not found`);
    return res.status(200).json({ username: 'unregisteredDevice', points: 0 });
  }

  const decoded = device.public_key
    ? await validateJWT(req.headers.authorization, device.public_key)
    : null;

  if ((!decoded || decoded.identity !== dongleId)) {
    logger.info(`HTTP.OWNER JWT authorization failed, token: ${req.headers.authorization} device: ${JSON.stringify(device)}, decoded: ${JSON.stringify(decoded)}`);
    return res.status(401).send('Unauthorized.');
  }

  let owner = '';
  const points = 0;

  let account = await getAccountFromId(device.account_id);
  if (account != null && account.dataValues != null) {
    account = account.dataValues;
    [owner] = account.email.split('@');
    // TODO reimplement "points"
    // const stats = await models.all('SELECT SUM(distance_meters) as points FROM drives WHERE dongle_id IN (SELECT dongle_id FROM devices WHERE account_id=?)', account.id);
    // if (stats != null && stats.points != null) {
    //   points = stats.points;
    // }
  }

  const response = { username: owner, points };
  logger.info(`HTTP.OWNER for ${dongleId} returning: ${JSON.stringify(response)}`);

  return res.status(200).json(response);
}));

async function upload(req, res) {
  let { path } = req.query;
  const { dongleId } = req.params;
  const auth = req.headers.authorization;
  logger.info(`HTTP.UPLOAD_URL called for ${dongleId} and file ${path}: ${JSON.stringify(req.headers)}`);

  const device = await deviceController.getDeviceFromDongleId(dongleId);
  if (!device) {
    logger.info(`HTTP.UPLOAD_URL device ${dongleId} not found or not linked to an account / refusing uploads`);
    return res.status(404).send('Not Found.');
  }

  const decoded = device.public_key
    ? await validateJWT(req.headers.authorization, device.public_key)
      .catch((err) => logger.error(err))
    : null;

  if ((!decoded || decoded.identity !== dongleId)) {
    logger.info(`HTTP.UPLOAD_URL JWT authorization failed, token: ${auth} device: ${JSON.stringify(device)}, decoded: ${JSON.stringify(decoded)}`);
    return res.status(401).send('Unauthorized.');
  }

  await deviceController
    .updateLastPing(dongleId)
    .catch((err) => logger.error(err));

  let responseUrl = null;
  const ts = Date.now(); // we use this to make sure old URLs cannot be reused (timeout after 60min)

  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId).digest('hex');

  // boot log upload

  if (path.indexOf('boot/') === 0 || path.indexOf('crash/') === 0 || path.indexOf('bootlog.bz2') > 0) {
    if (path.indexOf('bootlog.bz2') > 0) { // pre-op 0.8 way of uploading bootlogs
      // file 2020-09-30--08-09-13--0/bootlog.bz2 to something like: boot/2021-05-11--03-03-38.bz2
      path = `boot/${path.split('--')[0]}--${path.split('--')[1]}.bz2`;
    }

    const filename = path.replace('/', '-');

    // TODO, allow multiple types
    const uploadType = path.indexOf('boot/') === 0 ? 'boot' : 'crash';

    // "boot-2021-04-12--01-45-30.bz" for example
    const directory = `${dongleId}/${dongleIdHash}/${uploadType}`;

    const token = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId + filename + directory + ts).digest('hex');

    responseUrl = `${process.env.BASE_UPLOAD_URL}?file=${filename}&dir=${directory}&dongleId=${dongleId}&ts=${ts}&token=${token}`;
    logger.info(`HTTP.UPLOAD_URL matched '${uploadType}' file upload, constructed responseUrl: ${responseUrl}`);
  } else {
    // "2021-04-12--01-44-25--0/qlog.bz2" for example
    const subdirPosition = path.split('--', 2).join('--').length;
    const filenamePosition = path.indexOf('/');
    if (subdirPosition > 0 && filenamePosition > subdirPosition) {
      const driveName = `${path.split('--')[0]}--${path.split('--')[1]}`;
      const segment = parseInt(path.split('--')[2].substr(0, path.split('--')[2].indexOf('/')), 10);
      let directory = `${path.split('--')[0]}--${path.split('--')[1]}/${segment}`;
      const filename = path.split('/')[1];

      let validRequest = false;

      if ((filename === 'fcamera.hevc' || filename === 'qcamera.ts' || filename === 'dcamera.hevc' || filename === 'rlog.bz2' || filename === 'qlog.bz2' || filename === 'ecamera.hevc')
                && (!Number.isNaN(segment) || (segment > 0 && segment < 1000))) {
        validRequest = true;
      }

      if (!validRequest) {
        logger.error(`HTTP.UPLOAD_URL invalid filename (${filename}) or invalid segment (${segment}), responding with HTTP 400`);
        return res.status(400).send('Malformed Request.');
      }

      const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT).update(driveName).digest('hex');

      directory = `${dongleId}/${dongleIdHash}/${driveIdentifierHash}/${directory}`;

      const token = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId + filename + directory + ts).digest('hex');
      responseUrl = `${process.env.BASE_UPLOAD_URL}?file=${filename}&dir=${directory}&dongleId=${dongleId}&ts=${ts}&token=${token}`;
      logger.info(`HTTP.UPLOAD_URL matched 'drive' file upload, constructed responseUrl: ${responseUrl}`);

      const drive = await deviceController.getDriveFromIdentifier(dongleId, driveName)
        .catch((err) => {
          logger.warn('drive failed to make', err);
        });

      logger.info('drive value', drive);
      logger.info('drive name:', driveName);

      if (drive === undefined || drive === null) {
        logger.info('CREATING NEW DRIVE');
        // create a new drive
        const timeSplit = driveName.split('--');
        const timeString = `${timeSplit[0]} ${timeSplit[1].replace(/-/g, ':')}`;

        const driveResult = await deviceController.updateOrCreateDrive(dongleId, driveName, {
          max_segment: segment,
          duration: 0,
          distance_meters: 0,
          filesize: 0,
          upload_complete: false,
          is_processed: false,
          drive_date: Date.parse(timeString),
          created: Date.now(),
          last_upload: Date.now(),
          is_preserved: false,
          is_deleted: false,
          is_physically_removed: false,
        });

        await deviceController.updateOrCreateDriveSegment(dongleId, driveName, segment, {
          duration: 0,
          distance_meters: 0,
          upload_complete: false,
          is_processed: false,
          is_stalled: false,
          created: Date.now(),
        });

        logger.info(`HTTP.UPLOAD_URL created new drive #${JSON.stringify(driveResult.lastID)}`);
      } else {
        logger.info('UPDATING DRIVE');
        await deviceController.updateOrCreateDrive(dongleId, driveName, {
          max_segment: Math.max(drive.max_segment, segment),
          upload_complete: false,
          is_processed: false,
          last_upload: Date.now(),
        });

        await deviceController.updateOrCreateDriveSegment(dongleId, driveName, segment, {
          duration: 0,
          distance_meters: 0,
          upload_complete: false,
          is_processed: false,
          is_stalled: false,
          created: Date.now(),
        });

        logger.info(`HTTP.UPLOAD_URL updated existing drive: ${JSON.stringify(drive)}`);
      }
    }
  }

  if (responseUrl == null) {
    logger.error('HTTP.UPLOAD_URL unable to match request, responding with HTTP 400');
    return res.status(400).send('Malformed Request.');
  }
  return res.status(200).json({ url: responseUrl, headers: { 'Content-Type': 'application/octet-stream' } });
}

// DRIVE & BOOT/CRASH LOG FILE UPLOAD URL REQUEST
router.get('/v1.3/:dongleId/upload_url', upload);
router.get('/v1.4/:dongleId/upload_url', upload);

// DEVICE REGISTRATION OR RE-ACTIVATION
router.post('/v2/pilotauth/', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  /* eslint-disable no-unused-vars */
  const {
    imei: imei1,
    imei2,
    serial,
    public_key: publicKey,
    register_token: registerToken,
  } = req.query;
  /* eslint-enable no-unused-vars */

  if (
    serial == null || serial.length < 5
    || publicKey == null || publicKey.length < 5
    || registerToken == null || registerToken.length < 5
  ) {
    logger.error(`HTTP.V2.PILOTAUTH a required parameter is missing or empty ${JSON.stringify(req.query)}`);
    return res.status(400).send('Malformed Request.');
  }

  const decoded = await validateJWT(registerToken, publicKey);
  if (!decoded || !decoded.register) {
    logger.error(`HTTP.V2.PILOTAUTH JWT token is invalid (${JSON.stringify(decoded)})`);
    return res.status(400).send('Malformed Request.');
  }

  const device = await deviceController.getDeviceFromSerial(serial);
  if (device == null) {
    logger.info(`HTTP.V2.PILOTAUTH REGISTERING NEW DEVICE (${imei1}, ${serial})`);

    // TODO: rewrite without while (true) loop
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const dongleId = crypto.randomBytes(4).toString('hex');
      const isDongleIdTaken = await deviceController.getDeviceFromDongleId(dongleId);
      if (isDongleIdTaken) {
        continue;
      }

      const newDevice = await deviceController.createDongle(dongleId, 0, imei1, serial, publicKey);

      logger.info('HTTP.V2.PILOTAUTH REGISTERED NEW DEVICE:', { newDevice, registerToken });
      return res.status(201).json({
        dongle_id: newDevice.dongle_id,
        access_token: 'DEPRECATED-BUT-REQUIRED-FOR-07',
      });
    }
  }

  await deviceController.updateDevice(device.dongle_id, {
    last_ping: Date.now(),
    public_key: publicKey,
  });

  logger.info(`HTTP.V2.PILOTAUTH REACTIVATING KNOWN DEVICE (${imei1}, ${serial}) with dongle_id ${device.dongle_id}`);
  return res.status(200).json({
    dongle_id: device.dongle_id,
    access_token: 'DEPRECATED-BUT-REQUIRED-FOR-07',
  });
});

// RETRIEVES DATASET FOR OUR MODIFIED CABANA - THIS RESPONSE IS USED TO FAKE A DEMO ROUTE
router.get('/useradmin/cabana_drive/:extendedRouteIdentifier', runAsyncWrapper(async (req, res) => {
  const { extendedRouteIdentifier } = req.params;
  const [dongleId, dongleIdHashReq, driveIdentifier, driveIdentifierHashReq] = extendedRouteIdentifier.split('|');

  const drive = await deviceController.getDrive(dongleId, driveIdentifier);
  if (!drive) {
    return res.status(404).json({ status: 'drive not found' });
  }

  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT).update(drive.dongle_id).digest('hex');
  const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT).update(drive.identifier).digest('hex');
  const driveUrl = `${process.env.BASE_DRIVE_DOWNLOAD_URL + drive.dongle_id}/${dongleIdHash}/${driveIdentifierHash}/${drive.identifier}`;

  if (dongleIdHash !== dongleIdHashReq || driveIdentifierHash !== driveIdentifierHashReq) {
    return res.status(400).json({ status: 'hashes not matching' });
  }

  if (!drive.is_processed) {
    return res.status(202).json({ status: 'drive is not processed yet' });
  }

  const logUrls = [];
  for (let i = 0; i <= drive.max_segment; i++) {
    logUrls.push(`${driveUrl}/${i}/rlog.bz2`);
  }

  return res.status(200).json({
    logUrls,
    driveUrl,
    name: `${drive.dongle_id}|${drive.identifier}`,
    driveIdentifier: drive.identifier,
    dongleId: drive.dongle_id,
  });
}));

export default router;
