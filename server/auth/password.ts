import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must not exceed 128 characters' };
  }
  return { valid: true };
}

export async function hashPassword(plainText: string): Promise<string> {
  const validation = validatePasswordStrength(plainText);
  if (!validation.valid) {
    throw new Error(validation.message || 'Invalid password');
  }
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (!plainText || !hash) return false;
  try {
    return await bcrypt.compare(plainText, hash);
  } catch (err) {
    console.error('[Auth] Error comparing password hash:', err);
    return false;
  }
}
