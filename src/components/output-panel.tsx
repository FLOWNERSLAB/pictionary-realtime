import { Loader } from '@digo-labs/ui';
import type { ReactNode } from 'react';
import { useState } from 'react';

type OutputPanelProps = {
  image: string | null;
  /** A live stream (WebRTC) shown instead of still frames. */
  video?: MediaStream | null;
  alt: string;
  loading?: boolean;
  empty: ReactNode;
  /** A corner note over the image: a blocked frame has to explain itself where you are looking. */
  warning?: string | null;
  /** Top-left corner: which model is painting. */
  label?: ReactNode;
  /** Bottom strip: live figures. */
  footer?: ReactNode;
  className?: string;
};

type Layer = { src: string; key: number };

/**
 * Two stacked layers: each new frame fades in over the previous one, so a 1-2 fps
 * stream reads as a morph instead of a slideshow of hard cuts.
 */
export const OutputPanel = ({ image, video, alt, loading, empty, warning, label, footer, className }: OutputPanelProps) => {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [shown, setShown] = useState<string | null>(null);

  // Derived during render, not in an effect: a new frame pushes a layer once.
  if (image !== shown) {
    setShown(image);
    setLayers(current => (image ? [...current.slice(-1), { src: image, key: (current.at(-1)?.key ?? 0) + 1 }] : []));
  }

  return (
    <div className={`lab-lightbox relative overflow-hidden ${className ?? ''}`}>
      {video ? (
        <video
          ref={element => {
            if (element && element.srcObject !== video) element.srcObject = video;
          }}
          autoPlay
          muted
          playsInline
          aria-label={alt}
          className="absolute inset-0 size-full object-cover"
        />
      ) : layers.length ? (
        layers.map((layer, index) => (
          <img
            key={layer.key}
            src={layer.src}
            alt={index === layers.length - 1 ? alt : ''}
            className={`absolute inset-0 size-full object-cover ${index === layers.length - 1 ? 'lab-frame-in' : ''}`}
          />
        ))
      ) : (
        <div className="text-neutral-11 absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
          {loading ? <Loader type="dotSpinner" size={28} color="currentColor" /> : null}
          {empty}
        </div>
      )}

      {warning ? (
        <p
          role="status"
          className="bg-warning-3/90 text-warning-11 border-warning-6 absolute top-3 right-3 max-w-[60%] rounded-xl border px-3 py-2 text-xs backdrop-blur"
        >
          {warning}
        </p>
      ) : null}

      {label ? <div className="pointer-events-none absolute top-3 left-3">{label}</div> : null}
      {footer ? <div className="pointer-events-none absolute inset-x-3 bottom-3">{footer}</div> : null}
    </div>
  );
};
