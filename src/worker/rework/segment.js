import Queue from 'bull';
import 'dotenv/config';

import Reader from '@commaai/log_reader';
import { execSync } from 'child_process';
import fs from 'fs';
import log4js from 'log4js';

import deviceController from '../../server/controllers/devices';
import { Accounts } from '../../models';
import { calculateDistance } from './helpers';

const logger = log4js.getLogger('worker');
const segmentQueue = new Queue('new_segment', process.env.REDIS_SERVER);

/*
   This script is just to fetch the git origin from a segment
   will be reworking the main worker to work under a queue system
   and will process each segment as it lands on the server
   instead of when its fully downloaded - adam
*/

async function readRlog(rLogPath) {
  const temporaryFile = rLogPath.replace('.bz2', '');

  try {
    // TODO ensure path is located within realdata
    execSync(`bunzip2 -k -f "${rLogPath}"`);
  } catch (exception) {
    // if bunzip2 fails, something was wrong with the file (corrupt / missing)
    logger.error('Failed to run bunzip2.', exception, rLogPath);
    try {
      fs.unlinkSync(temporaryFile);
    } catch (unlinkException) {
      logger.error('Failed to unlink temoprary file', unlinkException, rLogPath);
    }
    return false;
  }

  const readStream = fs.createReadStream(temporaryFile);

  return { stream: readStream, linked: temporaryFile };
}

function getSegmentLatLong(obj) {
  let lat;
  let long;

  if (obj.GpsLocation !== undefined) {
    lat = obj.GpsLocation.Latitude;
    long = obj.GpsLocation.Longitude;
  } else if (obj.GpsLocationExternal) {
    lat = obj.GpsLocationExternal.Latitude;
    long = obj.GpsLocationExternal.Longitude;
  } else {
    // not sure if we should return null or something more specific.
    return null;
  }

  return { lat, long };
}

// Users are able to tag sensitive areas such as
// their home addresses, this will then prevent
// the segments being shared outside of their
// account such as for model training, or
// to fork maintainers

function isSegmentSensitive(obj, sensitiveAreas) {
  const chords = getSegmentLatLong(obj);
  if (!chords) { return null; }
  let detected = false;
  sensitiveAreas.forEach((area) => {
    if (detected !== true) {
      detected = calculateDistance(area.lat, area.long, chords.lat, chords.long, false) < 500;
    }
  });

  return detected;
}

function GetSegmentGitOrigin(obj) {
  if (obj.InitData !== undefined) {
    if (obj.InitData.GitRemote) {
      // TODO don't like this, if for some reason the identifier
      // is invalid, it'll just create a new record? eeee.
      return obj.InitData.GitRemote.toString();
    }
  }
  return false;
}

const config = {
  getGitOrigin: true,
  getSensitiveStatus: true,
  getDistance: true,
};

function calculateSegmentDistance(
  obj,
  segmentDistanceCovered,
  lastSegmentTimesamp,
  lastSegmentChords,
) {
  const chords = getSegmentLatLong(obj);
  let newDistanceCovered = segmentDistanceCovered;

  if (
    obj.LogMonoTime
    && chords !== null
    && lastSegmentChords !== null
  ) {
    const dis = calculateDistance(
      lastSegmentChords.lat,
      lastSegmentChords.long,
      chords.lat,
      chords.long,
      true,
    );
    newDistanceCovered += dis;
  }
  return {
    segmentDistanceCovered: newDistanceCovered,
    lastSegmentTimesamp: obj.LogMonoTime,
    lastSegmentChords: chords || lastSegmentChords,
  };
}

async function processSegmentRLog(rLogPath, dongleId, identifier, segmentId) {
  const processStartTime = Date.now();
  // TODO handle this failing
  const readStream = await readRlog(rLogPath);
  const reader = Reader(readStream.stream);

  const dongle = await deviceController.getDeviceFromDongleId(dongleId);
  const account = await Accounts.findOne({ where: { id: dongle.account_id }, attributes: ['settings'] });
  let sensitiveAreas;

  if (account.settings) {
    try {
      const settings = JSON.parse(account.settings);
      if (settings.sensitiveAreas) {
        sensitiveAreas = settings.sensitiveAreas;
      }
    } catch (JSONParseException) {
      logger.warn('Failed to decode user settings', dongleId, account.id, JSONParseException);
      // return null;
    }
  }

  let segmentDistanceCovered = 0;
  let lastSegmentTimesamp = 0;
  let lastSegmentChords = null;
  let driveUpdates = {};
  let segmentUpdates = {};

  reader((obj) => {
    const disRes = calculateSegmentDistance(
      obj,
      segmentDistanceCovered,
      lastSegmentTimesamp,
      lastSegmentChords,
    );

    if (disRes.lastSegmentChords !== null) {
      segmentDistanceCovered = disRes.segmentDistanceCovered;
      lastSegmentTimesamp = disRes.lastSegmentTimesamp;
      lastSegmentChords = disRes.lastSegmentChords;
    }

    if (config.getGitOrigin) {
      const origin = GetSegmentGitOrigin(obj);
      if (origin) {
        driveUpdates = { ...driveUpdates, git_origin: origin.toString() };
      }
    }

    if (config.getSensitiveStatus && isSegmentSensitive(obj, sensitiveAreas) === true) {
      segmentUpdates = { ...segmentUpdates, sensitive: true };
    }
  });

  readStream.stream.on('close', () => {
    logger.info('Segment readstream closed, cleaning up', rLogPath);
    logger.info('Segment distance covered: ', segmentDistanceCovered);
    if (Object.keys(driveUpdates).length > 0) {
      logger.info('Segment readstream closed, updating drive');
      deviceController.updateOrCreateDrive(
        dongleId,
        identifier,
        driveUpdates,
      );
    }

    if (Object.keys(segmentUpdates).length > 0) {
      logger.info('Segment readstream closed, updating segment');
      deviceController.updateOrCreateDriveSegment(
        dongleId,
        identifier,
        segmentId,
        segmentUpdates,
      );
    }

    try {
      fs.unlinkSync(readStream.linked);
    } catch (unlinkException) {
      logger.error('Failed to unlink temoprary file on close', unlinkException, rLogPath);
    }

    logger.info(`Processing time: ${Date.now() - processStartTime}ms ${identifier}--${segmentId}`, rLogPath);
  });
}

export default async function processSegments() {
  segmentQueue.process(async (job, done) => {
    // dongle, hash, hash, identifier, segment
    const ops = job.data.segmentData.dir.split('/');
    const diskPath = `${process.env.storage_path}${job.data.segmentData.dir}\\${job.data.segmentData.file}`;
    const success = await processSegmentRLog(diskPath, ops[0], ops[3], ops[4])
      .catch((err) => {
        done(true, err);
      });

    if (success) {
      done();
    } else {
      done(true, success);
    }
  });
}
