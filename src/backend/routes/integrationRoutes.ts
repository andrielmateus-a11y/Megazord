import { Router } from 'express';
import * as c from '../controllers/integrationController.js';
import { requireRole } from '../middleware/auth.js';

// /api/casa-dos-dados
export const casaDosDadosRoutes = Router()
  .get('/status', c.cddStatus)
  .post('/test', c.cddTest)
  .post('/lookup/:cnpj', c.cddLookup)
  .post('/cache/clear', c.cddClearCache)
  .put('/key', requireRole('admin'), c.cddSetKey)
  .delete('/key', requireRole('admin'), c.cddRemoveKey)
  .post('/key/reveal', requireRole('admin'), c.cddRevealKey);

// /api/firefox
export const firefoxRoutes = Router()
  .get('/status', c.bridgeStatus)
  .post('/token', requireRole('admin'), c.bridgeToken)
  .post('/containers/sync', requireRole('admin', 'supervisor'), c.bridgeEnsureContainers);

// /api/evolution
export const evolutionRoutes = Router()
  .get('/status', c.evolutionStatus)
  .put('/config', requireRole('admin'), c.evolutionConfigure)
  .post('/test', c.evolutionTest)
  .post('/sync', c.evolutionSync);
