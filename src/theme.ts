import type { ThemePreset } from '@digo-labs/ui';
import { studioPreset } from '@digo-labs/ui';

/**
 * "Non-photo blue": the pale cyan pencil illustrators sketch with before inking.
 * The accent is that pencil; the neutral is warm graphite, so the only white on
 * screen is the paper the guest draws on.
 */
export const labPreset: ThemePreset = {
  ...studioPreset,
  name: 'pictionary-lab',
  colors: {
    neutral: 'sand',
    accent: 'sky',
    error: 'tomato',
    success: 'jade',
    warning: 'amber',
    info: 'sky',
  },
  typography: {
    header: { font: 'general-sans', weight: '600', tracking: '-0.02em', leading: '1' },
    label: { font: 'general-sans', weight: '500', tracking: '0em', leading: '1.2' },
    body: { font: 'satoshi', weight: '400', tracking: '0em', leading: '1.5' },
    code: { font: 'geist-mono', weight: '400', tracking: '0em', leading: '1.4' },
  },
  radius: '0.875rem',
};
