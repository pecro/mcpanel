// CSS-only "pixel landscape" — mountains, trees, sun. Mirrors D1_PixelLandscape
// in d1-launcher.jsx. Designed to absolutely-position inside a hero band.

const MOUNTAINS: Array<[number, number]> = [
  [40, 60], [120, 80], [220, 50], [320, 90], [420, 70], [520, 100],
  [640, 60], [740, 85], [860, 55], [960, 95], [1060, 70],
];

const TREES = [80, 200, 360, 480, 600, 700, 820, 980, 1080];

export function PixelLandscape() {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0" style={{ bottom: 28, height: 110, opacity: 0.55 }}>
        {MOUNTAINS.map(([x, h], i) => (
          <div
            key={i}
            className="pixel absolute"
            style={{
              left: x,
              bottom: 0,
              width: 80,
              height: h,
              background: 'linear-gradient(180deg, #8aa9b8 0%, #6c8a99 100%)',
              clipPath: 'polygon(0 100%, 50% 0, 100% 100%)',
            }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0" style={{ bottom: 28, height: 70 }}>
        {TREES.map((x, i) => (
          <div key={i} className="pixel absolute" style={{ left: x, bottom: 0, width: 28, height: 50 }}>
            <div className="absolute" style={{ left: 12, bottom: 0, width: 6, height: 14, background: '#5a3d22' }} />
            <div className="absolute" style={{ left: 0, bottom: 12, width: 28, height: 30, background: '#3f6b1f' }} />
            <div className="absolute" style={{ left: 4, bottom: 36, width: 20, height: 12, background: '#3f6b1f' }} />
          </div>
        ))}
      </div>
      <div
        className="pixel pointer-events-none absolute"
        style={{
          right: 60,
          top: 40,
          width: 40,
          height: 40,
          background: '#fff5b8',
          boxShadow: '0 0 0 6px rgba(255,245,184,.25)',
        }}
      />
    </>
  );
}
