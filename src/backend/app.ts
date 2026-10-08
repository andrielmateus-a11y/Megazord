// Montagem do app Express: segurança, CORS, rate limit, API e (opcionalmente) o frontend compilado.
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-token'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '16mb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.isTest ? 100000 : 600,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path.startsWith('/webhook'),
      message: { error: 'Muitas requisições. Aguarde um instante.' },
    }),
  );
  app.use('/api', apiRouter());
  app.use('/api', notFoundHandler);

  // Deploy em um único serviço: o backend também pode servir o build do frontend (dist/web).
  const webDir = path.resolve(process.cwd(), 'dist/web');
  if (config.serveFrontend && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
