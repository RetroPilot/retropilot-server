import express from 'express';
import log4js from 'log4js';

import admin from './admin';
import auth from './auth';
import devices from './devices';
import useradmin from './useradmin';

// /api
const router = express.Router();

router.use('/admin', admin);
router.use('/auth', auth);
router.use('/devices', devices);
router.use('/useradmin', useradmin);

// TODO: setup oauth and twofactor endpoints
// app.use(routers.oauthAuthenticator);

export default router;
