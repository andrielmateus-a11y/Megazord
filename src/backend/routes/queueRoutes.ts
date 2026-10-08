import { Router } from 'express';
import * as c from '../controllers/queueController.js';
import { requireRole } from '../middleware/auth.js';

const manage = requireRole('admin', 'supervisor');

export const queueRoutes = Router()
  .get('/', c.list)
  .get('/monitor', c.getMonitor)
  .post('/pause', manage, c.pauseAll)
  .post('/resume', manage, c.resumeAll)
  .post('/process', manage, c.processNow)
  .post('/clear-cancelled', manage, c.clearCancelled)
  .post('/:id/cancel', c.cancel)
  .post('/:id/retry', c.retry);

export const dashboardRoutes = Router().get('/', c.getDashboard);
