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
   * This checks what is the current state of the table in the database (which
   * columns it has, what are their data types, etc), and then performs the
   * necessary changes in the table to make it match the model.
   *
   * WARNING: If force is set, sequelize will delete columns and create new ones
   *          if their types have changed!
   *          Use sequelize-cli and migrations instead!
   */
  const options = {
    alter: true,
    force: process.env.DB_FORCE_SYNC === 'true',
  };
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
