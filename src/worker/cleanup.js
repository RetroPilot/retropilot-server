import crypto from 'crypto';
import dirTree from 'directory-tree';
import fs from 'fs';
import log4js from 'log4js';

import { Drives } from '../models';
import orm from '../models/orm';
import { deleteFolderRecursive } from './storage';

const logger = log4js.getLogger('cleanup');

export let affectedDevices = {};

async function deleteBootAndCrashLogs() {
  const [devices] = await orm.query('SELECT * FROM devices');
  if (devices == null) {
    return;
  }

  for (let t = 0; t < devices.length; t++) {
    const device = devices[t];
    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(device.dongle_id)
      .digest('hex');

    const bootlogDirectoryTree = dirTree(`${process.env.STORAGE_PATH + device.dongle_id}/${dongleIdHash}/boot/`, { attributes: ['size'] });
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

    const crashlogDirectoryTree = dirTree(`${process.env.STORAGE_PATH + device.dongle_id}/${dongleIdHash}/crash/`, { attributes: ['size'] });
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

  const [expiredDrives] = await orm.query(`SELECT * FROM drives WHERE is_preserved = false AND is_deleted = false AND created < ${expirationTs}`);
  if (!expiredDrives) {
    return;
  }

  for (let t = 0; t < expiredDrives.length; t++) {
    logger.info(`deleteExpiredDrives drive ${expiredDrives[t].dongle_id} ${expiredDrives[t].identifier} is older than ${process.env.DEVICE_EXPIRATION_DAYS} days, set is_deleted=true`);
    await Drives.update(
      {
        is_deleted: true,
      },
      { where: { id: expiredDrives[t].id } },
    );
  }
}

async function deleteOverQuotaDrives() {
  const [devices] = await orm.query(`SELECT * FROM devices WHERE storage_used > ${process.env.DEVICE_STORAGE_QUOTA_MB}`);
  if (devices == null) {
    return;
  }

  for (let t = 0; t < devices.length; t++) {
    let foundDriveToDelete = false;

    const [driveNormal] = await orm.query(`SELECT * FROM drives WHERE dongle_id = ${devices[t].dongle_id} AND is_preserved = false AND is_deleted = false ORDER BY created ASC LIMIT 1`);
    if (driveNormal != null) {
      logger.info(`deleteOverQuotaDrives drive ${driveNormal.dongle_id} ${driveNormal.identifier} (normal) is deleted for over-quota`);
      await orm.query(`UPDATE drives SET is_deleted = true WHERE id = ${driveNormal.id}`);
      foundDriveToDelete = true;
    }

    if (!foundDriveToDelete) {
      const [drivePreserved] = await orm.query('SELECT * FROM drives WHERE dongle_id = devices[t].dongle_id AND is_preserved = true AND is_deleted = false ORDER BY created ASC LIMIT 1');
      if (drivePreserved != null) {
        logger.info(`deleteOverQuotaDrives drive ${drivePreserved.dongle_id} ${drivePreserved.identifier} (preserved!) is deleted for over-quota`);
        await orm.query(`UPDATE drives SET is_deleted = ? WHERE id = ${drivePreserved.id}`);
        foundDriveToDelete = true;
      }
    }
  }
}

async function removeDeletedDrivesPhysically() {
  const [deletedDrives] = await orm.query('SELECT * FROM drives WHERE is_deleted = true AND is_physically_removed = false');
  if (!deletedDrives) {
    return;
  }

  for (let t = 0; t < deletedDrives.length; t++) {
    logger.info(`removeDeletedDrivesPhysically drive ${deletedDrives[t].dongle_id} ${deletedDrives[t].identifier} is deleted, remove physical files and clean database`);

    const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(deletedDrives[t].dongle_id)
      .digest('hex');
    const driveIdentifierHash = crypto.createHmac('sha256', process.env.APP_SALT)
      .update(deletedDrives[t].identifier)
      .digest('hex');

    const drivePath = `${process.env.STORAGE_PATH + deletedDrives[t].dongle_id}/${dongleIdHash}/${driveIdentifierHash}`;
    logger.info(`removeDeletedDrivesPhysically drive ${deletedDrives[t].dongle_id} ${deletedDrives[t].identifier} storage path is ${drivePath}`);
    try {
      const driveResult = await orm.query(`UPDATE drives SET is_physically_removed = true WHERE id = ${deletedDrives[t].id}`);

      const driveSegmentResult = await orm.query(
        `DELETE FROM drive_segments WHERE drive_identifier = ${deletedDrives[t].identifier} AND dongle_id = ${deletedDrives[t].dongle_id}`,
      );

      if (driveResult != null && driveSegmentResult != null) {
        deleteFolderRecursive(drivePath, { recursive: true });
      }
      affectedDevices[deletedDrives[t].dongle_id] = true;
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
