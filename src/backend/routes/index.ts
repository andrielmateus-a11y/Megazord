// Montagem de todas as rotas da API.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authRoutes } from './authRoutes.js';
import { campaignRoutes } from './campaignRoutes.js';
import { casaDosDadosRoutes, evolutionRoutes, firefoxRoutes } from './integrationRoutes.js';
import { leadRoutes } from './leadRoutes.js';
import { companyRoutes, contactRoutes } from './prospectingRoutes.js';
import { dashboardRoutes, queueRoutes } from './queueRoutes.js';
import { settingsRoutes, userRoutes } from './settingsRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { channelRoutes, chatRoutes, messageRoutes, templateRoutes } from './whatsappRoutes.js';

export function apiRouter() {
  const api = Router();
  api.get('/health', (_req, res) => res.json({ ok: true, name: 'MEGAZORD', time: new Date().toISOString() }));
  api.use('/auth', authRoutes);
  api.use('/webhook', webhookRoutes);

  const p = Router();
  p.use(requireAuth);
  p.use('/dashboard', dashboardRoutes);
  p.use('/companies', companyRoutes);
  p.use('/contacts', contactRoutes);
  p.use('/leads', leadRoutes);
  p.use('/casa-dos-dados', casaDosDadosRoutes);
  p.use('/whatsapp/channels', channelRoutes);
  p.use('/whatsapp/chats', chatRoutes);
  p.use('/whatsapp/messages', messageRoutes);
  p.use('/whatsapp/templates', templateRoutes);
  p.use('/evolution', evolutionRoutes);
  p.use('/firefox', firefoxRoutes);
  p.use('/campaigns', campaignRoutes);
  p.use('/queue', queueRoutes);
  p.use('/settings', settingsRoutes);
  p.use('/users', userRoutes);
  api.use(p);
  return api;
}
