import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

export const authRoutes = Router()
  .get('/status', c.status)
  .post('/register', loginLimiter, c.register)
  .post('/login', loginLimiter, c.login)
  .post('/logout', requireAuth, c.logout)
  .get('/me', requireAuth, c.me)
  .patch('/me', requireAuth, c.updateProfile)
  .post('/change-password', requireAuth, loginLimiter, c.changePassword);
