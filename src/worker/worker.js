import 'dotenv/config';

import Reader from '@commaai/log_reader';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dirTree from 'directory-tree';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import log4js from 'log4js';
import { Op } from 'sequelize';

import { Devices, Drives, DriveSegments } from '../models';
import { affectedDevices, doCleanup } from './cleanup';
import { initializeStorage } from './storage';

const logger = log4js.getLogger();

const startTime = Date.now();
let lastCleaningTime = 0;

let segmentProcessQueue = [];
let segmentProcessPosition = 0;

let affectedDrives = {};
let affectedDriveInitData = {};
let affectedDriveCarParams = {};

let rlogLastTsInternal = 0;
let rlogPrevLatInternal = -1000;
let rlogPrevLngInternal = -1000;
let rlogTotalDistInternal = 0;
let rlogLastTsExternal = 0;
let rlogPrevLatExternal = -1000;
let rlogPrevLngExternal = -1000;
let rlogTotalDistExternal = 0;
let rlogCarParams = null;
let rlogInitData = null;
let qcameraDuration = 0;

function calculateDistance(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295; // Math.PI / 180
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2
    + c(lat1 * p) * c(lat2 * p) * ((1 - c((lon2 - lon1) * p)) / 2);

  let distMetres = 1000 * 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
  if (distMetres > 70) {
    // each segment is max. 60s. if the calculated speed would exceed ~250km/h for this segment, we assume the coordinates off / defective and skip it
    distMetres = 0;
  }
  return distMetres;
}

function processSegmentRLog(rLogPath) {
  rlogLastTsInternal = 0;
  rlogPrevLatInternal = -1000;
  rlogPrevLngInternal = -1000;
  rlogTotalDistInternal = 0;
  rlogLastTsExternal = 0;
  rlogPrevLatExternal = -1000;
  rlogPrevLngExternal = -1000;
  rlogTotalDistExternal = 0;
  rlogCarParams = null;
  rlogInitData = null;

  return new Promise((resolve) => {
    const temporaryFile = rLogPath.replace('.bz2', '');

    try {
      execSync(`bunzip2 -k -f "${rLogPath}"`);
    } catch (exception) { // if bunzip2 fails, something was wrong with the file (corrupt / missing)
      logger.error(exception);
      try {
        fs.unlinkSync(temporaryFile);
        // eslint-disable-next-line no-empty
      } catch (ignored) {
      }
      resolve();
      return;
    }

    let readStream;
    let reader;

    try {
      readStream = fs.createReadStream(temporaryFile);
      reader = Reader(readStream);
    } catch (err) {
      logger.error('314 - logger', err);
    }

    readStream.on('close', () => {
      logger.info('processSegmentRLog readStream close event triggered, resolving promise');
      try {
        fs.unlinkSync(temporaryFile);
        // eslint-disable-next-line no-empty
      } catch (ignored) {
      }
      resolve();
    });

    try {
      reader((obj) => {
        try {
          if (
            obj.LogMonoTime
            && obj.LogMonoTime - rlogLastTsInternal >= 1000000 * 1000 * 0.99
            && obj.GpsLocation
          ) {
            logger.info(`processSegmentRLog GpsLocation @ ${obj.LogMonoTime}: ${obj.GpsLocation.Latitude} ${obj.GpsLocation.Longitude}`);

            if (rlogPrevLatInternal !== -1000) {
              rlogTotalDistInternal += calculateDistance(
                rlogPrevLatInternal,
                rlogPrevLngInternal,
                obj.GpsLocation.Latitude,
                obj.GpsLocation.Longitude,
              );
            }

            rlogPrevLatInternal = obj.GpsLocation.Latitude;
            rlogPrevLngInternal = obj.GpsLocation.Longitude;
            rlogLastTsInternal = obj.LogMonoTime;
          } else if (
            obj.LogMonoTime
            && obj.LogMonoTime - rlogLastTsExternal >= 1000000 * 1000 * 0.99
            && obj.GpsLocationExternal
          ) {
            logger.info(`processSegmentRLog GpsLocationExternal @ ${obj.LogMonoTime}: ${obj.GpsLocationExternal.Latitude} ${obj.GpsLocationExternal.Longitude}`);

            if (rlogPrevLatExternal !== -1000) {
              rlogTotalDistExternal += calculateDistance(
                rlogPrevLatExternal,
                rlogPrevLngExternal,
                obj.GpsLocationExternal.Latitude,
                obj.GpsLocationExternal.Longitude,
              );
            }

            rlogPrevLatExternal = obj.GpsLocationExternal.Latitude;
            rlogPrevLngExternal = obj.GpsLocationExternal.Longitude;
            rlogLastTsExternal = obj.LogMonoTime;
          } else if (obj.LogMonoTime && obj.CarParams && !rlogCarParams) {
            rlogCarParams = obj.CarParams;
          } else if (obj.LogMonoTime && obj.InitData && !rlogInitData) {
            rlogInitData = obj.InitData;
          }
          // eslint-disable-next-line no-empty
        } catch (ignored) {
        }
      });
    } catch (readerErr) {
      throw new Error('reader Err 385', readerErr);
    }
  });
}

function processSegmentVideo(qcameraPath) {
  qcameraDuration = 0;
  return new Promise((resolve) => {
    ffprobe(qcameraPath, { path: ffprobeStatic.path })
      .then((info) => {
        if (info.streams && info.streams[0] && info.streams[0].duration) {
          qcameraDuration = info.streams[0].duration;
        }
        logger.info(`processSegmentVideo duration: ${qcameraDuration}s`);
        resolve();
      })
      .catch((err) => {
        console.error(err);
        logger.error(`processSegmentVideo error: ${err}`);
        resolve();
      });
  });
}

async function processSegmentsRecursive() {
  if (segmentProcessQueue.length <= segmentProcessPosition) {
    await updateDrives();
    return;
  }

  const {
    segment,
    uploadComplete,
    driveIdentifier,
    fileStatus,
  } = segmentProcessQueue[segmentProcessPosition];

  logger.info(`processSegmentsRecursive ${segment.dongle_id} ${segment.drive_identifier} ${segment.segment_id} ${JSON.stringify(segment)}`);

  segment.process_attempts += 1;

  DriveSegments.update({
    process_attempts: segment.process_attempts,
  }, {
    where: { id: segment.id },
  });

  if (segment.process_attempts > 5) {
    logger.error(`FAILING TO PROCESS SEGMENT,${segment.dongle_id} ${segment.drive_identifier} ${segment.segment_id} JSON: ${JSON.stringify(segment)} SKIPPING `);
    segmentProcessPosition += 1;
  } else {
    Promise.all([
      processSegmentRLog(fileStatus['rlog.bz2']),
      processSegmentVideo(fileStatus['qcamera.ts']),
    ])
      .then(async () => {
        logger.info(`processSegmentsRecursive ${segment.dongle_id} ${segment.drive_identifier} ${segment.segment_id} internal gps: ${Math.round(rlogTotalDistInternal * 100) / 100}m, external gps: ${Math.round(rlogTotalDistExternal * 100) / 100}m, duration: ${qcameraDuration}s`);

        const driveSegmentResult = await DriveSegments.update({
          duration: Math.round(qcameraDuration),
          distance_meters: Math.round(
            Math.max(rlogTotalDistInternal, rlogTotalDistExternal) * 10,
          ) / 10,
          is_processed: true,
          upload_complete: uploadComplete,
          is_stalled: false,
        }, { where: { id: segment.id } });

        // if the update failed, stop right here with segment processing and try to update the drives at least
        if (!driveSegmentResult) {
          segmentProcessPosition = segmentProcessQueue.length;
        }

        affectedDrives[driveIdentifier] = true;
        if (rlogCarParams) {
          affectedDriveCarParams[driveIdentifier] = rlogCarParams;
        }
        if (rlogInitData) {
          affectedDriveInitData[driveIdentifier] = rlogInitData;
        }

        segmentProcessPosition += 1;
        setTimeout(processSegmentsRecursive);
      })
      .catch((error) => {
        logger.error(error);
      });
  }
}

async function updateSegments() {
  segmentProcessQueue = [];
  segmentProcessPosition = 0;
  affectedDrives = {};
  affectedDriveCarParams = {};
  affectedDriveInitData = {};

  const segments = await DriveSegments.findAll({
    where: {
      upload_complete: false,
      is_stalled: false,
      process_attempts: {
        [Op.lt]: 5,
      },
    },
    order: [['created', 'ASC']],
  });
  logger.info('updateSegments - total segments', segments.length);

  if (segments) {
    for (let t = 0; t < segments.length; t++) {
      const segment = segments[t];

      const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
        .update(segment.dongle_id)
        .digest('hex');
      const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
        .update(segment.drive_identifier)
        .digest('hex');

      const directoryTreePath = `${process.env.STORAGE_PATH + segment.dongle_id}/${dongleIdHash}/${driveIdentifierHash}/${segment.drive_identifier}/${segment.segment_id}`;
      const directoryTree = dirTree(directoryTreePath);

      if (!directoryTree || !directoryTree.children) {
        console.log('missing directory', directoryTreePath);
        continue; // happens if upload in progress (db entity written but directory not yet created)
      }

      const fileStatus = {
        'fcamera.hevc': false,
        'dcamera.hevc': false,
        'qcamera.ts': false,
        'qlog.bz2': false,
        'rlog.bz2': false,
      };

      directoryTree.children.forEach((file) => {
        if (file.name in fileStatus) {
          fileStatus[file.name] = true;
        }
      });

      const uploadComplete = Object.keys(fileStatus).every((key) => fileStatus[key]);

      if (fileStatus['qcamera.ts'] !== false && fileStatus['rlog.bz2'] !== false && !segment.is_processed) {
        // can process
        segmentProcessQueue.push({
          segment,
          fileStatus,
          uploadComplete,
          driveIdentifier: `${segment.dongle_id}|${segment.drive_identifier}`,
        });
      } else if (uploadComplete) {
        logger.info(`updateSegments uploadComplete for ${segment.dongle_id} ${segment.drive_identifier} ${segment.segment_id}`);

        await DriveSegments.update({
          upload_complete: true,
          is_stalled: false,
        }, { where: { id: segment.id } });

        affectedDrives[`${segment.dongle_id}|${segment.drive_identifier}`] = true;
      } else if (Date.now() - segment.created > 10 * 24 * 3600 * 1000) {
        // ignore non-uploaded segments after 10 days until a new upload_url is requested (which resets is_stalled)
        logger.info(`updateSegments isStalled for ${segment.dongle_id} ${segment.drive_identifier} ${segment.segment_id}`);

        await DriveSegments.update({
          is_stalled: true,
        }, { where: { id: segment.id } });
      }

      // we process at most 15 segments per batch
      if (segmentProcessQueue.length >= 15) {
        break;
      }
    }
  }

  if (segmentProcessQueue.length > 0) {
    await processSegmentsRecursive();
  } else {
    // if no data is to be collected, call updateDrives to update those where eventually just the last segment completed the upload
    await updateDrives();
  }
}

async function updateDevices() {
  // go through all affected devices (with deleted or updated drives) and update them (storage_used)
  logger.info(`updateDevices - affected drives: ${JSON.stringify(affectedDevices)}`);

  await Promise.all(Object.keys(affectedDevices).map(async (dongleId) => {
    const device = await Devices.findOne({ where: { dongle_id: dongleId } });
    if (!device) {
      logger.warn(`updateDevices - device not found for dongle_id ${dongleId}`);
      return;
    }

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(device.dongle_id)
      .digest('hex');
    const devicePath = `${process.env.STORAGE_PATH + device.dongle_id}/${dongleIdHash}`;
    const deviceQuotaMb = Math.round(parseInt(execSync(`du -s ${devicePath} | awk -F'\t' '{print $1;}'`)
      .toString(), 10) / 1024);
    logger.info(`updateDevices device ${dongleId} has an updated storage_used of: ${deviceQuotaMb} MB`);

    await Devices.update(
      { storage_used: deviceQuotaMb },
      { where: { dongle_id: device.dongle_id } },
    );

    delete affectedDevices[dongleId];
  }));
}

async function updateDrives() {
  // go through all affected drives and update them / complete and/or build m3u8
  logger.info(`updateDrives - affected drives: ${JSON.stringify(affectedDrives)}`);

  await Promise.all(Object.keys(affectedDrives).map(async (key) => {
    const [dongleId, driveIdentifier] = key.split('|');

    const drive = await Drives.findOne({
      where: {
        identifier: driveIdentifier,
        dongle_id: dongleId,
      },
    });
    if (!drive) {
      logger.warn('updateDrives drive not found', key);
      return;
    }

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(drive.dongle_id)
      .digest('hex');
    const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(drive.identifier)
      .digest('hex');
    const driveUrl = `${process.env.BASE_DRIVE_DOWNLOAD_URL + drive.dongle_id}/${dongleIdHash}/${driveIdentifierHash}/${drive.identifier}`;
    const drivePath = `${process.env.STORAGE_PATH + drive.dongle_id}/${dongleIdHash}/${driveIdentifierHash}/${drive.identifier}`;

    let uploadComplete = true;
    let isProcessed = true;

    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let playlistSegmentStrings = '';

    const driveSegments = await DriveSegments.findAll({
      where: {
        drive_identifier: driveIdentifier,
        dongle_id: dongleId,
      },
      order: [['segment_id', 'ASC']],
    });

    if (driveSegments) {
      for (let t = 0; t < driveSegments.length; t++) {
        if (!driveSegments[t].upload_complete) uploadComplete = false;
        if (!driveSegments[t].is_processed) {
          isProcessed = false;
        } else {
          totalDistanceMeters += parseFloat(driveSegments[t].distance_meters);
          totalDurationSeconds += parseFloat(driveSegments[t].duration);

          playlistSegmentStrings += `#EXTINF:${driveSegments[t].duration},${driveSegments[t].segment_id}\n${driveUrl}/${driveSegments[t].segment_id}/qcamera.ts\n`;
        }
      }
    } else {
      logger.warn('updateDrives driveSegments not found', key);
    }

    let { filesize } = drive;
    if (uploadComplete) {
      try {
        filesize = parseInt(execSync(`du -s ${drivePath} | awk -F'\t' '{print $1;}'`)
          .toString(), 10); // in kilobytes
        // eslint-disable-next-line no-empty
      } catch (exception) {
      }
    }

    let metadata = {};
    try {
      metadata = JSON.parse(drive.metadata);
    } catch (exception) {
      logger.error(exception);
    }
    if (metadata == null) metadata = {};

    if (affectedDriveInitData[key] && !metadata.InitData) {
      metadata.InitData = affectedDriveInitData[key];
    }
    if (affectedDriveCarParams[key] && !metadata.CarParams) {
      metadata.CarParams = affectedDriveCarParams[key];
    }

    logger.info(`updateDrives drive ${dongleId} ${driveIdentifier} uploadComplete: ${uploadComplete}`);

    await Drives.update(
      {
        distance_meters: Math.round(totalDistanceMeters),
        duration: Math.round(totalDurationSeconds),
        upload_complete: uploadComplete,
        is_processed: isProcessed,
        filesize,
        metadata: JSON.stringify(metadata),
      },
      { where: { id: drive.id } },
    );

    affectedDevices[dongleId] = true;

    if (isProcessed) {
      // create the playlist file m3u8 for cabana
      const playlist = '#EXTM3U\n'
        + '#EXT-X-VERSION:3\n'
        + '#EXT-X-TARGETDURATION:61\n'
        + '#EXT-X-MEDIA-SEQUENCE:0\n'
        + `#EXT-X-PLAYLIST-TYPE:VOD\n${playlistSegmentStrings}\n`
        + '#EXT-X-ENDLIST';

      fs.writeFileSync(`${drivePath}/qcamera.m3u8`, playlist);
    }
  }));

  await updateDevices();

  setTimeout(mainWorkerLoop);
}

async function mainWorkerLoop() {
  if (Date.now() - startTime > 60 * 60 * 1000) {
    logger.info('EXIT WORKER AFTER 1 HOUR TO PREVENT MEMORY LEAKS...');
    process.exit();
    return;
  }

  try {
    if (Date.now() - lastCleaningTime > 20 * 60 * 1000) {
      await doCleanup();
      lastCleaningTime = Date.now();
    }

    setTimeout(updateSegments, 5000);
  } catch (e) {
    logger.error(e);
  }
}

export default async () => {
  initializeStorage();
  setTimeout(mainWorkerLoop);
};
