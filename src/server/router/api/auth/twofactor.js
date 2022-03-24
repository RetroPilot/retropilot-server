import express from 'express';

import { requireAuthenticated } from '../../../middlewares/authentication';

const router = express.Router();

router.get('/authentication/twofactor/enrol', requireAuthenticated, async () => {
  // TODO: implementation
});

export default router;
