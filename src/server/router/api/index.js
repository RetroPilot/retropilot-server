import express from 'express';

import admin from './admin';
import auth from './auth';
import devices from './devices';
import useradmin from './useradmin';
import userSettings from './user/settings';

// /api
const router = express.Router();

router.use('/admin', admin);
router.use('/auth', auth);
router.use('/devices', devices);
router.use('/useradmin', useradmin);
router.use('/user/settings', userSettings);

console.log(userSettings);

// TODO: setup oauth and twofactor endpoints
// app.use(routers.oauthAuthenticator);

export default router;
