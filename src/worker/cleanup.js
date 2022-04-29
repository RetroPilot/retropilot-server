import crypto from 'crypto';
import dirTree from 'directory-tree';
import fs from 'fs';
import log4js from 'log4js';
import { Op } from 'sequelize';

import { Devices, Drives, DriveSegments } from '../models';
import { deleteFolderRecursive } from './storage';

const logger = log4js.getLogger('cleanup');

export const affectedDevices = {};

async function deleteBootAndCrashLogs() {
  const devices = await Devices.findAll();
  if (!devices) {
    logger.warn('deleteBootAndCrashLogs No devices found');
    return;
  }

  for (let t = 0; t < devices.length; t++) {
    const device = devices[t];
    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(device.dongle_id)
      .digest('hex');

    const bootlogDirectoryTree = dirTree(`${process.env.STORAGE_PATH}${device.dongle_id}/${dongleIdHash}/boot/`, { attributes: ['size'] });
    const bootlogFiles = [];
    if (bootlogDirectoryTree) {
      for (let i = 0; i < bootlogDirectoryTree.children.length; i++) {
        const timeSplit = bootlogDirectoryTree.children[i].name.replace('boot-', '')
          .replace('crash-', '')
          .replace('.bz2', '')
          .split('--');
        const timeString = `${timeSplit[0]} ${timeSplit[1].replace(/-/g, ':')}`;
        bootlogFiles.push({
          name: bootlogDirectoryTree.children[i].name,
          size: bootlogDirectoryTree.children[i].size,
          date: Date.parse(timeString),
          path: bootlogDirectoryTree.children[i].path,
        });
      }
      bootlogFiles.sort((a, b) => ((a.date < b.date) ? 1 : -1));
      for (let c = 5; c < bootlogFiles.length; c++) {
        logger.info(`deleteBootAndCrashLogs deleting boot log ${bootlogFiles[c].path}`);
        try {
          fs.unlinkSync(bootlogFiles[c].path);
          affectedDevices[device.dongle_id] = true;
        } catch (exception) {
          logger.error(exception);
        }
      }
    }

    const crashlogDirectoryTree = dirTree(`${process.env.STORAGE_PATH}${device.dongle_id}/${dongleIdHash}/crash/`, { attributes: ['size'] });
    const crashlogFiles = [];
    if (crashlogDirectoryTree) {
      for (let i = 0; i < crashlogDirectoryTree.children.length; i++) {
        const timeSplit = crashlogDirectoryTree.children[i].name.replace('boot-', '')
          .replace('crash-', '')
          .replace('.bz2', '')
          .split('--');
        const timeString = `${timeSplit[0]} ${timeSplit[1].replace(/-/g, ':')}`;
        crashlogFiles.push({
          name: crashlogDirectoryTree.children[i].name,
          size: crashlogDirectoryTree.children[i].size,
          date: Date.parse(timeString),
          path: crashlogDirectoryTree.children[i].path,
        });
      }
      crashlogFiles.sort((a, b) => ((a.date < b.date) ? 1 : -1));
      for (let c = 5; c < crashlogFiles.length; c++) {
        logger.info(`deleteBootAndCrashLogs deleting crash log ${crashlogFiles[c].path}`);
        try {
          fs.unlinkSync(crashlogFiles[c].path);
          affectedDevices[device.dongle_id] = true;
        } catch (exception) {
          logger.error(exception);
        }
      }
    }
  }
}

async function deleteExpiredDrives() {
  const expirationTs = Date.now() - process.env.DEVICE_EXPIRATION_DAYS * 24 * 3600 * 1000;
  const expiredDrives = Drives.findAll({
    where: {
      is_preserved: false,
      is_deleted: false,
      created: { [Op.lt]: expirationTs },
    },
  });
  if (!expiredDrives) {
    logger.info('deleteExpiredDrives No expired drives found');
    return;
  }

  for (let t = 0; t < expiredDrives.length; t++) {
    logger.info(`deleteExpiredDrives drive ${expiredDrives[t].dongle_id} ${expiredDrives[t].identifier} is older than ${process.env.DEVICE_EXPIRATION_DAYS} days, set is_deleted=true`);
    await Drives.update(
      { is_deleted: true },
      { where: { id: expiredDrives[t].id } },
    );
  }
}

async function deleteOverQuotaDrives() {
  const devices = await Devices.findAll({
    where: {
      storage_used: { [Op.gt]: process.env.DEVICE_STORAGE_QUOTA_MB },
    },
  });
  if (devices === null) {
    logger.info('deleteOverQuotaDrives No over quota devices found');
    return;
  }

  for (let t = 0; t < devices.length; t++) {
    const { dongle_id: dongleId } = devices[t];
    const drive = await Drives.findOne({
      where: {
        dongle_id: dongleId,
        is_deleted: false,
        is_preserved: false,
      },
      order: [['created', 'ASC']],
    });

    if (drive) {
      logger.info(`deleteOverQuotaDrives drive ${drive.dongle_id} ${drive.identifier} (normal) is deleted for over-quota`);
      await Drives.update(
        { is_deleted: true },
        { where: { id: drive.id } },
      );
    } else {
      const preservedDrive = await Drives.findOne({
        where: {
          dongle_id: dongleId,
          is_preserved: true,
          is_deleted: false,
        },
        order: [['created', 'ASC']],
      });
      if (preservedDrive) {
        logger.info(`deleteOverQuotaDrives drive ${preservedDrive.dongle_id} ${preservedDrive.identifier} (preserved!) is deleted for over-quota`);
        await Drives.update(
          { is_deleted: true },
          { where: { id: preservedDrive.id } },
        );
      }
    }
  }
}

async function removeDeletedDrivesPhysically() {
  const deletedDrives = await Drives.findAll({
    where: {
      is_deleted: true,
      is_physically_removed: false,
    },
  });
  if (!deletedDrives) {
    logger.info('removeDeletedDrivesPhysically no deleted drives found');
    return;
  }

  for (let t = 0; t < deletedDrives.length; t++) {
    const drive = deletedDrives[t];
    const {
      id,
      dongle_id: dongleId,
      identifier,
    } = drive;
    logger.info(`removeDeletedDrivesPhysically drive ${dongleId} ${identifier} is deleted, remove physical files and clean database`);

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(dongleId)
      .digest('hex');
    const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(identifier)
      .digest('hex');

    const drivePath = `${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/${driveIdentifierHash}`;
    logger.info(`removeDeletedDrivesPhysically drive ${dongleId} ${identifier} storage path is ${drivePath}`);
    try {
      const driveResult = await Drives.update({
        is_physically_removed: true,
      }, {
        where: { id },
      });

      const driveSegmentResult = await DriveSegments.update({
        is_physically_removed: true,
      }, {
        where: { drive_identifier: identifier, dongle_id: dongleId },
      });

      if (driveResult && driveSegmentResult) {
        deleteFolderRecursive(drivePath, { recursive: true });
      }
      affectedDevices[drive.dongle_id] = true;
    } catch (exception) {
      logger.error(exception);
    }
  }
}

export async function doCleanup() {
  await deleteBootAndCrashLogs();
  await deleteExpiredDrives();
  await deleteOverQuotaDrives();
  await removeDeletedDrivesPhysically();
}
