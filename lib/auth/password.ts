export const MINIMUM_PASSWORD_LENGTH = 8;

export function getPasswordValidationError(password: string) {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
