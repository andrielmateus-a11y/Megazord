import { Router } from 'express';
import * as c from '../controllers/settingsController.js';
import * as users from '../controllers/userController.js';
import { requireRole } from '../middleware/auth.js';

export const settingsRoutes = Router()
  .get('/account', c.account)
  .put('/account', requireRole('admin'), c.saveAccount)
  .get('/logs', requireRole('admin', 'supervisor'), c.logs)
  .get('/export/:kind', c.exportData)
  .post('/import/:kind', requireRole('admin', 'supervisor'), c.importData);

export const userRoutes = Router()
  .get('/', requireRole('admin', 'supervisor'), users.list)
  .post('/', requireRole('admin'), users.create)
  .patch('/:id', requireRole('admin'), users.update);
