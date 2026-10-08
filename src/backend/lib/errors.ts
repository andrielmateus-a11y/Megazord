// Erros de aplicação com mensagens legíveis para o usuário.
// Detalhes técnicos ficam no log, nunca na interface.

export class AppError extends Error {
  constructor(
    public status: number,
    public userMessage: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(userMessage);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Sessão expirada. Entre novamente.') => new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError(403, msg, 'forbidden');
export const notFound = (msg = 'Registro não encontrado.') => new AppError(404, msg, 'not_found');
export const conflict = (msg: string) => new AppError(409, msg, 'conflict');

/** Erro de integração externa (Casa dos Dados, Evolution, Bridge). */
export class IntegrationError extends Error {
  constructor(
    public provider: string,
    public userMessage: string,
    public technical?: string,
    public httpStatus?: number,
    public retryable = true,
  ) {
    super(`${provider}: ${technical ?? userMessage}`);
  }
}
