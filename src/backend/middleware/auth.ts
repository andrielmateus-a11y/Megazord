// Autenticação (Bearer token opaco) e autorização por papel.
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../shared/constants.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { resolveSession } from '../services/authService.js';

export interface AuthContext {
  userId: number;
  accountId: number;
  role: Role;
  name: string;
  token: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function extractToken(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    const session = await resolveSession(token);
    if (!session) throw unauthorized();
    req.auth = { ...session, token };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
