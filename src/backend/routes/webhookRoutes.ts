import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/webhookController.js';

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 1200, standardHeaders: true, legacyHeaders: false });

export const webhookRoutes = Router().use(limiter).post('/evolution', c.evolution).post('/evolution/:event', c.evolution).post('/whatsapp', c.whatsapp);
