import express from 'express';
import rateLimit from 'express-rate-limit';
import log4js from 'log4js';

import athena from '../../websocket/athena';

import admin from './admin';
import auth from './auth';
import devices from './devices';
import realtime from './realtime';
import useradmin from './useradmin';

const logger = log4js.getLogger();

// /api
const router = express.Router();

router.use('/admin', admin);
router.use('/auth', auth);
router.use('/devices', devices);
router.use('/useradmin', useradmin);

// TODO: setup oauth and twofactor endpoints
// app.use(routers.oauthAuthenticator);

if (process.env.ATHENA_ENABLED) {
  logger.info('Athena enabled');

  const athenaRateLimit = rateLimit({
    windowMs: 30000,
    max: process.env.ATHENA_API_RATE_LIMIT,
  });

  router.use((req, res, next) => {
    req.athenaWebsocketTemp = athena;
    return next();
  });

  router.use('/realtime', athenaRateLimit);
  router.use('/realtime', realtime);
} else {
  logger.info('Athena disabled');
}

export default router;
