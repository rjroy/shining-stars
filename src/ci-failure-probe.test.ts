import { expect, it } from 'vitest';

it('deliberately verifies GitHub PR failure reporting; remove after validation', () => {
  expect('deliberate CI failure probe').toBe('passing state');
});
