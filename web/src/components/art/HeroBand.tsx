import type { ReactNode } from 'react';
import { PixelLandscape } from './PixelLandscape';

export function HeroBand({
  height = 280,
  children,
  backgroundImage,
}: {
  height?: number;
  children?: ReactNode;
  /** When set, replace the procedural sky+landscape with this image
   *  (object-fit: cover). The grass-side strip is kept either way so the
   *  edge against the panel below stays consistent. */
  backgroundImage?: string;
}) {
  return (
    <div className="relative overflow-hidden" style={{ height }}>
      {backgroundImage ? (
        <img
          src={backgroundImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, #6cb1d8 0%, #a9d3e8 55%, #d8e8ee 100%)',
            }}
          />
          <PixelLandscape />
        </>
      )}
      <div className="tex-grass-side pixel absolute inset-x-0 bottom-0 h-7" />
      {children}
    </div>
  );
}
