import 'dotenv/config';
import http from 'http';
import log4js from 'log4js';

import app from './app';
import storageController from './controllers/storage';
import orm, {
  Accounts,
  Devices,
  Drives,
  DriveSegments,
} from '../models';

export default async () => {
  const logger = log4js.getLogger();

  storageController.initializeStorage();
  await storageController.updateTotalStorageUsed();

  /**
   * Synchronise the database (create new tables) to match the models defined
   * above.
   *
   * WARNING: If force is set, sequelize will delete columns and create new ones
   *          if their types have changed!
   *          Use sequelize-cli and migrations instead!
   */
  const options = { force: process.env.DB_FORCE_SYNC === 'true' };
  await orm.sync(options);
  logger.info('Database synced', options);

  // debug: print out some info from the database
  await Promise.all([
    Accounts.findAll(),
    Devices.findAll(),
    Drives.findAll(),
    DriveSegments.findAll(),
  ]).then(([
    accounts,
    devices,
    drives,
    driveSegments,
  ]) => {
    logger.info(`Found ${accounts.length} accounts`);
    logger.info(`Found ${devices.length} devices`);
    logger.info(`Found ${drives.length} drives`);
    logger.info(`Found ${driveSegments.length} drive segments`);
  });

  const httpServer = http.createServer(await app());
  httpServer.listen(process.env.HTTP_PORT, () => {
    logger.info(`RetroPilot Server listening at ${process.env.BASE_URL}`);
  });
};
