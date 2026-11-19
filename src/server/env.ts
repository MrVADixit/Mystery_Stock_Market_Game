/** Validated access to the server environment. */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function authSecret(): string {
  const secret = requiredEnv('AUTH_SECRET');
  if (secret.length < 24) {
    throw new Error('AUTH_SECRET must be at least 24 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return secret;
}

export const isProduction = () => process.env.NODE_ENV === 'production';

/** True when the optional AI assistant has credentials configured. */
export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());
