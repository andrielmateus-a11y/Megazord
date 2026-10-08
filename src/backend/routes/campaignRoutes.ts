import { Router } from 'express';
import * as c from '../controllers/campaignController.js';
import { requireRole } from '../middleware/auth.js';

const manage = requireRole('admin', 'supervisor');

export const campaignRoutes = Router()
  .get('/', c.list)
  .post('/preview', c.preview)
  .post('/', manage, c.create)
  .get('/:id', c.get)
  .put('/:id', manage, c.update)
  .delete('/:id', manage, c.remove)
  .post('/:id/:action', manage, c.action);
