import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/dbClient.js';
import { ROLES } from '../../shared/constants.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { auth } from '../middleware/auth.js';
import { cleanText, idParam, parse } from '../middleware/validate.js';
import { userRepository, sessionRepository } from '../repositories/userRepository.js';
import { hashPassword, validatePasswordStrength } from '../services/authService.js';
import { log } from '../services/logService.js';

export async function list(req: Request, res: Response) {
  res.json({ users: await userRepository.listByAccount(auth(req).accountId) });
}

export async function create(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(
    z.object({
      name: cleanText(120).pipe(z.string().min(2)),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200),
      role: z.enum(ROLES),
    }),
    req.body,
  );
  validatePasswordStrength(body.password);
  if (await userRepository.findByEmailWithHash(body.email)) throw conflict('Este e-mail já está cadastrado.');
  const user = await userRepository.create(db(), { accountId: a.accountId, name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password) });
  await log({ accountId: a.accountId, userId: a.userId, category: 'users', action: 'create', message: `Usuário ${body.email} criado (${body.role})` });
  res.status(201).json({ user });
}

export async function update(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const body = parse(
    z.object({
      name: cleanText(120).pipe(z.string().min(2)).optional(),
      role: z.enum(ROLES).optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).max(200).optional(),
    }),
    req.body,
  );
  if (id === a.userId && (body.active === false || (body.role && body.role !== 'admin'))) {
    throw badRequest('Você não pode desativar ou rebaixar o próprio usuário.');
  }
  let passwordHash: string | undefined;
  if (body.password) {
    validatePasswordStrength(body.password);
    passwordHash = await hashPassword(body.password);
  }
  const user = await userRepository.update(a.accountId, id, { name: body.name, role: body.role, active: body.active, passwordHash });
  if (!user) throw notFound('Usuário não encontrado.');
  if (body.active === false || body.password) await sessionRepository.deleteAllForUser(id);
  await log({ accountId: a.accountId, userId: a.userId, category: 'users', action: 'update', message: `Usuário ${user.email} atualizado`, meta: { role: body.role, active: body.active, passwordReset: !!body.password } });
  res.json({ user });
}
