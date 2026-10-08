// Autenticação própria: bcrypt para senhas, tokens opacos de sessão (hash SHA-256 no banco).
import bcrypt from 'bcryptjs';
import { db } from '../../db/dbClient.js';
import type { Role } from '../../shared/constants.js';
import type { User } from '../../shared/types.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { sessionRepository, userRepository } from '../repositories/userRepository.js';
import { bootstrapAccount } from './accountService.js';
import { log } from './logService.js';

const BCRYPT_ROUNDS = 12;
let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.isTest ? 4 : BCRYPT_ROUNDS);
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 8) throw badRequest('A senha deve ter pelo menos 8 caracteres.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw badRequest('A senha deve conter letras e números.');
  }
}

async function issueSession(user: User, meta: { userAgent?: string; ip?: string }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  await sessionRepository.create(user.id, sha256(token), expiresAt, meta.userAgent, meta.ip);
  return { token, expiresAt: expiresAt.toISOString(), user };
}

export async function registrationStatus() {
  const users = await userRepository.count();
  return { firstUser: users === 0, open: users === 0 || config.allowRegistration };
}

export async function register(
  input: { name: string; email: string; password: string; companyName?: string },
  meta: { userAgent?: string; ip?: string },
) {
  validatePasswordStrength(input.password);
  const { firstUser, open } = await registrationStatus();
  if (!open) throw forbidden('O cadastro público está desativado. Peça acesso a um administrador.');
  if (await userRepository.findByEmailWithHash(input.email)) throw conflict('Este e-mail já está cadastrado.');
  const passwordHash = await hashPassword(input.password);

  const user = await db().tx(async (q) => {
    let accountId: number;
    let role: Role = 'sdr';
    if (firstUser) {
      accountId = await bootstrapAccount(q, input.companyName?.trim() || 'MEGAZORD');
      role = 'admin';
    } else {
      const [acc] = await q.query('SELECT id FROM accounts ORDER BY id LIMIT 1');
      accountId = acc.id;
    }
    return userRepository.create(q, { accountId, name: input.name, email: input.email, passwordHash, role });
  });
  await log({ accountId: user.accountId, userId: user.id, category: 'auth', action: 'register', message: `Perfil criado: ${user.email} (${user.role})` });
  return issueSession(user, meta);
}

export async function login(email: string, password: string, meta: { userAgent?: string; ip?: string }) {
  const row = await userRepository.findByEmailWithHash(email);
  // Compara mesmo quando o usuário não existe, para não revelar e-mails cadastrados pelo tempo de resposta.
  dummyHash ??= await hashPassword('megazord-dummy-password');
  const ok = await bcrypt.compare(password, row?.password_hash ?? dummyHash);
  if (!row || !ok) {
    await log({ accountId: row?.account_id ?? null, level: 'warn', category: 'auth', action: 'login_failed', message: `Tentativa de login falhou`, meta: { email, ip: meta.ip } });
    throw unauthorized('E-mail ou senha inválidos.');
  }
  if (!row.active) throw forbidden('Seu usuário está desativado.');
  await userRepository.touchLogin(row.id);
  const user = (await userRepository.findById(row.id))!;
  await log({ accountId: user.accountId, userId: user.id, category: 'auth', action: 'login', message: `Login: ${user.email}`, meta: { ip: meta.ip } });
  return issueSession(user, meta);
}

export async function logout(token: string) {
  await sessionRepository.delete(sha256(token));
}

export async function resolveSession(token: string) {
  if (!token) return null;
  const row = await sessionRepository.findValid(sha256(token));
  if (!row || !row.active) return null;
  return { userId: row.user_id as number, accountId: row.account_id as number, role: row.role as Role, name: row.name as string };
}

export async function changePassword(userId: number, accountId: number, current: string, next: string, keepToken: string) {
  const hash = await userRepository.findHashById(userId);
  if (!hash || !(await bcrypt.compare(current, hash))) throw badRequest('Senha atual incorreta.');
  validatePasswordStrength(next);
  await userRepository.update(accountId, userId, { passwordHash: await hashPassword(next) });
  await sessionRepository.deleteAllForUser(userId, sha256(keepToken));
  await log({ accountId, userId, category: 'security', action: 'password_changed', message: 'Senha alterada; outras sessões encerradas.' });
}
