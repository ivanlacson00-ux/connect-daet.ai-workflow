import assert from 'node:assert/strict';
import test from 'node:test';
import { getPasswordValidationError, MINIMUM_PASSWORD_LENGTH } from '../lib/auth/password.ts';

test('password requirement is shared and enforced at eight characters', () => {
  assert.equal(MINIMUM_PASSWORD_LENGTH, 8);
  assert.equal(getPasswordValidationError('1234567'), 'Password must be at least 8 characters.');
  assert.equal(getPasswordValidationError('12345678'), null);
});
