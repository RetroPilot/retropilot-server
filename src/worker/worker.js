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

const logger = log4js.getLogger('worker');

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
      // TODO ensure path is located within realdata
      execSync(`bunzip2 -k -f "${rLogPath}"`);
    } catch (exception) {
      // if bunzip2 fails, something was wrong with the file (corrupt / missing)
      logger.error('Failed to run bunzip2.', exception, rLogPath);
      try {
        fs.unlinkSync(temporaryFile);
      } catch (ignored) {
        logger.error('Failed to unlink temoprary file', exception, rLogPath);
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
  logger.info('processSegmentsRecursive');

  if (segmentProcessQueue.length <= segmentProcessPosition) {
    logger.info('processSegmentsRecursive segmentProcessQueue empty');
    await updateDrives();
    return;
  }

  const {
    segment,
    uploadComplete,
    driveIdentifier,
    fileStatus,
  } = segmentProcessQueue[segmentProcessPosition];

  const {
    dongle_id: dongleId,
    segment_id: segmentId,
  } = segment;

  logger.info(`processSegmentsRecursive ${dongleId} ${driveIdentifier} ${segmentId} ${JSON.stringify(segment)}`);

  segment.process_attempts += 1;

  await DriveSegments.update({
    process_attempts: segment.process_attempts,
  }, {
    where: { id: segment.id },
  });

  if (segment.process_attempts > 5) {
    logger.error(`FAILING TO PROCESS SEGMENT,${dongleId} ${driveIdentifier} ${segmentId} JSON: ${JSON.stringify(segment)} SKIPPING `);
    segmentProcessPosition += 1;
  } else {
    await Promise.all([
      processSegmentRLog(fileStatus['rlog.bz2']),
      processSegmentVideo(fileStatus['qcamera.ts']),
    ])
      .then(async () => {
        logger.info(`processSegmentsRecursive ${dongleId} ${driveIdentifier} ${segmentId} internal gps: ${Math.round(rlogTotalDistInternal * 100) / 100}m, external gps: ${Math.round(rlogTotalDistExternal * 100) / 100}m, duration: ${qcameraDuration}s`);

        const driveSegmentResult = await DriveSegments.update({
          duration: Math.round(qcameraDuration),
          distance_meters: Math.round(Math.max(rlogTotalDistInternal, rlogTotalDistExternal)),
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
      [Op.or]: [
        { process_attempts: { [Op.lt]: 5 } },
        { process_attempts: null },
      ],
    },
    order: [['created', 'ASC']],
  });
  logger.info('updateSegments - total segments', segments.length);

  await Promise.all(segments.map(async (segment) => {
    // we process at most 15 segments per batch
    if (segmentProcessQueue.length >= 15) {
      return;
    }

    const {
      id,
      created,
      dongle_id: dongleId,
      drive_identifier: driveIdentifier,
      is_processed: isProcessed,
      segment_id: segmentId,
    } = segment;
    logger.debug('updateSegments - segment', driveIdentifier, segmentId);

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(dongleId)
      .digest('hex');
    const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(driveIdentifier)
      .digest('hex');

    const directoryTreePath = `${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/${driveIdentifierHash}/${driveIdentifier}/${segmentId}`;
    const directoryTree = dirTree(directoryTreePath);

    if (!directoryTree || !directoryTree.children) {
      logger.warn('updateSegments - missing directory', directoryTreePath);
      return; // happens if upload in progress (db entity written but directory not yet created)
    }

    // TODO: abstract this out
    const SegmentFiles = {
      fcamera: 'fcamera.hevc',
      dcamera: 'dcamera.hevc',
      qcamera: 'qcamera.ts',
      qlog: 'qlog.bz2',
      rlog: 'rlog.bz2',
    };
    const fileStatus = {
      [SegmentFiles.fcamera]: undefined,
      [SegmentFiles.dcamera]: undefined,
      [SegmentFiles.qcamera]: undefined,
      [SegmentFiles.qlog]: undefined,
      [SegmentFiles.rlog]: undefined,
    };

    directoryTree.children.forEach((file) => {
      if (file.name in fileStatus) {
        logger.debug('updateSegments - found file', file.name);
        fileStatus[file.name] = file.path;
      }
    });

    // dcamera not required for "upload complete"
    const uploadComplete = [
      SegmentFiles.fcamera,
      SegmentFiles.qcamera,
      SegmentFiles.qlog,
      SegmentFiles.rlog,
    ].every((key) => !!fileStatus[key]);
    logger.debug('updateSegments - uploadComplete', uploadComplete);

    if (fileStatus[SegmentFiles.qcamera] && fileStatus[SegmentFiles.rlog] && !isProcessed) {
      // can process
      logger.debug('updateSegments - can process', id);
      segmentProcessQueue.push({
        segment,
        fileStatus,
        uploadComplete,
        driveIdentifier: `${dongleId}|${driveIdentifier}`,
      });
    } else if (uploadComplete) {
      logger.info(`updateSegments uploadComplete for ${dongleId} ${driveIdentifier} ${segmentId}`);

      await DriveSegments.update({
        upload_complete: true,
        is_stalled: false,
      }, { where: { id } });

      affectedDrives[`${dongleId}|${driveIdentifier}`] = true;
    } else if (Date.now() - created > 10 * 24 * 3600 * 1000) {
      // ignore non-uploaded segments after 10 days until a new upload_url is requested (which resets is_stalled)
      logger.warn(`updateSegments isStalled for ${dongleId} ${driveIdentifier} ${segmentId}`);

      await DriveSegments.update({
        is_stalled: true,
      }, { where: { id } });
    }
  }));

  if (segmentProcessQueue.length > 0) {
    logger.info('updateSegments - processing', segmentProcessQueue.length);
    await processSegmentsRecursive();
  } else {
    // if no data is to be collected, call updateDrives to update those where eventually just the last segment completed the upload
    logger.info('updateSegments - no segments to process, updating drives...');
    await updateDrives();
  }
}

async function updateDevices() {
  // go through all affected devices (with deleted or updated drives) and update them (storage_used)
  logger.info(`updateDevices - affected devices: ${JSON.stringify(affectedDevices)}`);

  await Promise.all(Object.keys(affectedDevices).map(async (dongleId) => {
    const device = await Devices.findOne({ where: { dongle_id: dongleId } });
    if (!device) {
      logger.warn(`updateDevices - device not found for dongle_id ${dongleId}`);
      return;
    }

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(dongleId)
      .digest('hex');
    const devicePath = `${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}`;
    const deviceQuotaMb = Math.round(parseInt(execSync(`du -s ${devicePath} | awk -F'\t' '{print $1;}'`)
      .toString(), 10) / 1024);
    logger.info(`updateDevices device ${dongleId} has an updated storage_used of: ${deviceQuotaMb} MB`);

    await Devices.update(
      { storage_used: deviceQuotaMb },
      { where: { dongle_id: dongleId } },
    );

    delete affectedDevices[dongleId];
  }));
}

async function updateDrives() {
  // go through all affected drives and update them / complete and/or build m3u8
  logger.info(`updateDrives - affected drives: ${JSON.stringify(affectedDrives)}`);

  await Promise.all(Object.keys(affectedDrives).map(async (key) => {
    const [dongleId, identifier] = key.split('|');

    const drive = await Drives.findOne({
      where: {
        identifier,
        dongle_id: dongleId,
      },
    });
    if (!drive) {
      logger.warn('updateDrives drive not found', key);
      return;
    }

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(dongleId)
      .digest('hex');
    const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(identifier)
      .digest('hex');
    const driveUrl = `${process.env.BASE_DRIVE_DOWNLOAD_URL}${dongleId}/${dongleIdHash}/${driveIdentifierHash}/${identifier}`;
    const drivePath = `${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/${driveIdentifierHash}/${identifier}`;

    let uploadComplete = true;
    let isProcessed = true;

    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let playlistSegmentStrings = '';

    const driveSegments = await DriveSegments.findAll({
      where: {
        drive_identifier: identifier,
        dongle_id: dongleId,
      },
      order: [['segment_id', 'ASC']],
    });

    if (driveSegments) {
      driveSegments.forEach((driveSegment) => {
        if (!driveSegment.upload_complete) {
          uploadComplete = false;
        }
        if (!driveSegment.is_processed) {
          isProcessed = false;
        } else {
          totalDistanceMeters += parseFloat(driveSegment.distance_meters);
          totalDurationSeconds += parseFloat(driveSegment.duration);

          playlistSegmentStrings += `#EXTINF:${driveSegment.duration},${driveSegment.segment_id}\n${driveUrl}/${driveSegment.segment_id}/qcamera.ts\n`;
        }
      });
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
    if (metadata == null) {
      metadata = {};
    }

    if (affectedDriveInitData[key] && !metadata.InitData) {
      metadata.InitData = affectedDriveInitData[key];
    }
    if (affectedDriveCarParams[key] && !metadata.CarParams) {
      metadata.CarParams = affectedDriveCarParams[key];
    }

    logger.info(`updateDrives drive ${dongleId} ${identifier} uploadComplete: ${uploadComplete}`);

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
    // 💀
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
