import { Router } from 'express';
import * as c from '../controllers/whatsappController.js';
import { requireRole } from '../middleware/auth.js';

const manage = requireRole('admin', 'supervisor');

export const channelRoutes = Router()
  .get('/', c.listChannels)
  .get('/rotation', c.rotation)
  .post('/', manage, c.addChannel)
  .patch('/:id', manage, c.updateChannel)
  .delete('/:id', requireRole('admin'), c.removeChannel)
  .get('/:id/logs', c.channelLogs)
  .post('/:id/:action', c.channelAction);

export const chatRoutes = Router().get('/', c.listChats).get('/:id', c.getChat).patch('/:id/lead', c.linkChatLead);

export const messageRoutes = Router()
  .post('/send', c.send)
  .post('/activation/preview', c.previewActivation)
  .post('/activation/send', c.sendActivation);

export const templateRoutes = Router()
  .get('/', c.listTemplates)
  .post('/', c.createTemplate)
  .post('/preview', c.previewTemplate)
  .patch('/:id', c.updateTemplate)
  .post('/:id/duplicate', c.duplicateTemplate)
  .delete('/:id', c.deleteTemplate);
