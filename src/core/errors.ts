export type ErrorCode =
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'expired'
  | 'rate_limited'
  | 'unauthenticated'
  | 'locked';

/** Erreur métier : son message est affiché tel quel à l'utilisateur. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new DomainError(code, message);
}
