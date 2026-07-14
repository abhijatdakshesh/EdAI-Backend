import { haversineKm, etaMinutes } from './geo';

describe('geo', () => {
  // Bengaluru landmarks ~ known distances
  const majestic = { lat: 12.9767, lng: 77.5713 };
  const koramangala = { lat: 12.9352, lng: 77.6245 };

  it('computes haversine distance within tolerance', () => {
    const d = haversineKm(majestic, koramangala);
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(9); // ~7.2 km
  });

  it('is zero for identical points', () => {
    expect(haversineKm(majestic, majestic)).toBeCloseTo(0, 5);
  });

  it('estimates ETA from speed', () => {
    const eta = etaMinutes(majestic, koramangala, 30);
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThan(60);
  });

  it('falls back to a nominal speed when speed is missing/too low', () => {
    const withLow = etaMinutes(majestic, koramangala, 0);
    const withNominal = etaMinutes(majestic, koramangala, 20);
    expect(withLow).toBe(withNominal);
  });

  it('returns null when a coordinate is missing', () => {
    expect(etaMinutes(null, koramangala, 30)).toBeNull();
    expect(etaMinutes(majestic, null, 30)).toBeNull();
  });
});
