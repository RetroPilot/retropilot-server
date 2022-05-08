import Queue from 'bull';
import 'dotenv/config';

import Reader from '@commaai/log_reader';
import { execSync } from 'child_process';
import fs from 'fs';
import log4js from 'log4js';

import deviceController from '../../server/controllers/devices';

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
    execSync(`bunzip2 -k -f "${rLogPath}"`);
  } catch (exception) { // if bunzip2 fails, something was wrong with the file (corrupt / missing)
    logger.error(exception);
    try {
      fs.unlinkSync(temporaryFile);
      // eslint-disable-next-line no-empty
    } catch (ignored) {}
    return null;
  }

  const readStream = fs.createReadStream(temporaryFile);

  readStream.on('close', () => {
    logger.info('processSegmentRLog readStream close event triggered, resolving promise');
    try {
      fs.unlinkSync(temporaryFile);
      // eslint-disable-next-line no-empty
    } catch (ignored) {
    }
  });

  return readStream;
}

async function processSegmentRLog(rLogPath, dongleId, identifier) {
  const temporaryFile = rLogPath.replace('.bz2', '');

  const readStream = await readRlog(rLogPath);

  const reader = Reader(readStream);

  readStream.on('close', () => {
    logger.info('processSegmentRLog readStream close event triggered, resolving promise');
    try {
      fs.unlinkSync(temporaryFile);
      // eslint-disable-next-line no-empty
    } catch (ignored) {
    }
    return null;
  });

  try {
    reader(async (obj) => {
      try {
        if (obj.InitData !== undefined) {
          // TODO don't like this, if for some reason the identifier
          // is invalid, it'll just create a new record? eeee.
          deviceController.updateOrCreateDrive(
            dongleId,
            identifier,
            { git_origin: obj.InitData.GitRemote.toString() },
          );
        }
        // eslint-disable-next-line no-empty
      } catch (e) {}
    });
    // eslint-disable-next-line no-empty
  } catch (readerErr) {
  }
}

export default async function processSegments() {
  segmentQueue.process(async (job, done) => {
    // dongle, hash, hash, identifier, segment
    const ops = job.data.segmentData.dir.split('/');
    const diskPath = `${process.env.storage_path}${job.data.segmentData.dir}\\${job.data.segmentData.file}`;
    await processSegmentRLog(diskPath, ops[0], ops[3], ops[4]);
    done();
  });
}
