// Validação e sanitização de entrada com zod.
import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') || 'dados';
    throw badRequest(`Campo inválido: ${field} — ${first?.message ?? 'valor inválido'}`, result.error.issues);
  }
  return result.data;
}

export const validateBody =
  <S extends ZodTypeAny>(schema: S) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parse(schema, req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };

/** Texto limpo: remove caracteres de controle (exceto quebras de linha) e espaços nas pontas. */
export const cleanText = (max = 500) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim());

export const idParam = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Identificador inválido.');
  return n;
};
