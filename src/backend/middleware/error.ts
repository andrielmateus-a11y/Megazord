// Tratamento central de erros: mensagem legível ao usuário, detalhe técnico só no log do servidor.
import type { NextFunction, Request, Response } from 'express';
import { AppError, IntegrationError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Rota não encontrada.', code: 'not_found' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.userMessage, code: err.code });
  }
  if (err instanceof IntegrationError) {
    console.warn(`[integration] ${err.message}`);
    return res.status(502).json({ error: err.userMessage, code: 'integration_error', provider: err.provider });
  }
  if ((err as any)?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.', code: 'bad_request' });
  }
  if ((err as any)?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Conteúdo muito grande.', code: 'too_large' });
  }
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.', code: 'internal' });
}
