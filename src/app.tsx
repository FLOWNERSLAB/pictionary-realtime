import { DesignSystemProvider, DrawingProvider, ToastProvider, TooltipProvider } from '@digo-labs/ui';

import { Studio } from './components/studio';
import { labPreset } from './theme';

/**
 * A digo app gets these providers from `defineApp`. Standalone they go here by
 * hand, and TooltipProvider is not optional: every toolbar button is wrapped in
 * a Tooltip, which renders nothing without it — the drawing toolbar comes out empty.
 */
export const App = () => (
  <DesignSystemProvider preset={labPreset} defaultMode="dark">
    <TooltipProvider>
      <ToastProvider>
        <DrawingProvider defaultColor="#0a0a0a" defaultSize={10}>
          <Studio />
        </DrawingProvider>
      </ToastProvider>
    </TooltipProvider>
  </DesignSystemProvider>
);
