import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// next/image demande la configuration de Next.js : une simple image suffit dans les tests
vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: Record<string, unknown>) =>
    createElement('img', props),
}));
