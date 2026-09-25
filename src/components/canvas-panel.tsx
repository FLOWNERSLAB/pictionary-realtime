import { DrawingCanvas, DrawingToolbar } from '@digo-labs/ui';
import type { ReactNode, RefObject } from 'react';

type CanvasPanelProps = {
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** Bumped on every pointer move so the render loop knows the drawing changed. */
  onInk: () => void;
  /**
   * Overlay mode (from realtime-canvas): the render sits under the paper and the
   * guest draws "into" it, with their strokes as a faint pencil ghost.
   */
  underlay?: ReactNode;
  className?: string;
  /** Hint drawn on the empty sheet. */
  emptyHint?: ReactNode;
  /** Top-left corner, above the ink: e.g. what the model actually receives. */
  corner?: ReactNode;
};

export const CanvasPanel = ({ wrapperRef, onInk, underlay, className, emptyHint, corner }: CanvasPanelProps) => (
  <div className={`lab-paper relative overflow-hidden ${underlay ? 'lab-overlay' : ''} ${className ?? ''}`}>
    {underlay ? <div className="absolute inset-0">{underlay}</div> : null}

    {emptyHint ? (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
        {emptyHint}
      </div>
    ) : null}

    <div
      ref={wrapperRef}
      onPointerDownCapture={onInk}
      onPointerMoveCapture={onInk}
      onPointerUpCapture={onInk}
      className="lab-ink absolute inset-0 touch-none"
    >
      <DrawingCanvas inputs="auto" classNames={{ root: underlay ? 'bg-transparent' : 'bg-white' }} />
    </div>

    {corner ? <div className="pointer-events-none absolute top-3 left-3">{corner}</div> : null}

    <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
      <DrawingToolbar palette={['#0a0a0a', '#e5484d', '#0090ff', '#30a46c', '#f76b15', '#ffc53d']} />
    </div>
  </div>
);
