import express from 'express';

import api from './api';
import legacy from './legacy';
import useradmin from './useradmin';

const router = express.Router();

// TODO: refactor
router.use(legacy);

router.use('/api', api);
router.use('/useradmin', useradmin);

export default router;
