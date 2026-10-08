import type { Request, Response } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { cleanText, parse } from '../middleware/validate.js';
import * as authService from '../services/authService.js';
import { userRepository } from '../repositories/userRepository.js';

const meta = (req: Request) => ({ userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300), ip: req.ip });

export async function status(_req: Request, res: Response) {
  res.json(await authService.registrationStatus());
}

export async function register(req: Request, res: Response) {
  const body = parse(
    z.object({
      name: cleanText(120).pipe(z.string().min(2, 'informe seu nome')),
      email: z.string().trim().toLowerCase().email('e-mail inválido').max(200),
      password: z.string().min(8).max(200),
      companyName: cleanText(120).optional(),
    }),
    req.body,
  );
  res.status(201).json(await authService.register(body, meta(req)));
}

export async function login(req: Request, res: Response) {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().email('e-mail inválido'), password: z.string().min(1).max(200) }), req.body);
  res.json(await authService.login(body.email, body.password, meta(req)));
}

export async function logout(req: Request, res: Response) {
  await authService.logout(auth(req).token);
  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  res.json({ user: await userRepository.findById(auth(req).userId) });
}

export async function updateProfile(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ name: cleanText(120).pipe(z.string().min(2)).optional(), settings: z.record(z.unknown()).optional() }), req.body);
  res.json({ user: await userRepository.update(a.accountId, a.userId, body) });
}

export async function changePassword(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }), req.body);
  await authService.changePassword(a.userId, a.accountId, body.currentPassword, body.newPassword, a.token);
  res.json({ ok: true });
}
