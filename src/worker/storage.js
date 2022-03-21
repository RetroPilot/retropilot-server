import path from 'path';
import fs from 'fs';
import log4js from 'log4js';

const logger = log4js.getLogger('default');

export function initializeStorage() {
  const verifiedPath = mkDirByPathSync(process.env.STORAGE_PATH, { isRelativeToScript: (process.env.STORAGE_PATH.indexOf('/') !== 0) });
  if (verifiedPath != null) {
    logger.info(`Verified storage path ${verifiedPath}`);
  } else {
    logger.error(`Unable to verify storage path '${process.env.STORAGE_PATH}', check filesystem / permissions`);
    process.exit();
  }
}

export function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
  const { sep } = path;
  const initDir = path.isAbsolute(targetDir) ? sep : '';

  let baseDir;
  if (isRelativeToScript) {
    // retropilot-server/dist/worker/../.. => retropilot-server
    baseDir = path.join(__dirname, '..', '..');
  } else {
    baseDir = '.';
  }

  return targetDir.split(sep)
    .reduce((parentDir, childDir) => {
      const curDir = path.resolve(baseDir, parentDir, childDir);
      try {
        fs.mkdirSync(curDir);
      } catch (err) {
        if (err.code === 'EEXIST') { // curDir already exists!
          return curDir;
        }

        // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
        if (err.code === 'ENOENT') { // Throw the original parentDir error on curDir `ENOENT` failure.
          logger.error(`EACCES: permission denied, mkdir '${parentDir}'`);
          return null;
        }

        const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1;
        if (!caughtErr || (caughtErr && curDir === path.resolve(targetDir))) {
          logger.error('\'EACCES\', \'EPERM\', \'EISDIR\' during mkdir');
          return null;
        }
      }

      return curDir;
    }, initDir);
}

export function writeFileSync(filePath, buffer, permission) {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(filePath, 'w', permission);
  } catch (e) {
    fs.chmodSync(filePath, permission);
    fileDescriptor = fs.openSync(filePath, 'w', permission);
  }

  if (fileDescriptor) {
    fs.writeSync(fileDescriptor, buffer, 0, buffer.length, 0);
    fs.closeSync(fileDescriptor);
    logger.info(`writeFileSync wiriting to '${filePath}' successful`);
    return true;
  }
  logger.error(`writeFileSync writing to '${filePath}' failed`);
  return false;
}

// eslint-disable-next-line
export function moveUploadedFile(buffer, directory, filename) {
  logger.info(`moveUploadedFile called with '${filename}' -> '${directory}'`);

  if (directory.indexOf('..') >= 0 || filename.indexOf('..') >= 0) {
    logger.error('moveUploadedFile failed, .. in directory or filename');
    return false;
  }

  if (process.env.STORAGE_PATH.lastIndexOf('/') !== process.env.STORAGE_PATH.length - 1) {
    directory = `/${directory}`;
  }
  if (directory.lastIndexOf('/') !== directory.length - 1) directory += '/';

  const finalPath = mkDirByPathSync(process.env.STORAGE_PATH + directory, { isRelativeToScript: (process.env.STORAGE_PATH.indexOf('/') !== 0) });
  if (finalPath && finalPath.length > 0) {
    if (writeFileSync(`${finalPath}/${filename}`, buffer, 0o660)) {
      logger.info(`moveUploadedFile successfully written '${finalPath}/${filename}'`);
      return `${finalPath}/${filename}`;
    }
    logger.error('moveUploadedFile failed to writeFileSync');
    return false;
  }
  logger.error(`moveUploadedFile invalid final path, check permissions to create / write '${process.env.STORAGE_PATH + directory}'`);
  return false;
}

export function deleteFolderRecursive(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath)
      .forEach((file) => {
        const curPath = path.join(directoryPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolderRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
    fs.rmdirSync(directoryPath);
  }
}
