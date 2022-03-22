import express from 'express';

import auth from './auth';
import devices from './devices';
import realtime from './realtime';

const router = express.Router();

// /api
router.use('/auth', auth);
router.use('/devices', devices);
router.use('/realtime', realtime);

export default router;
