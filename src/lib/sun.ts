/*
 * Where the sun is, for the home page's sky chart. Low-precision solar ephemeris
 * (good to about 0.01° in declination, a minute or so in rise and set times), which is
 * plenty for a drawing.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Delhi NCR, where the team works. */
export const SITE = { name: 'Delhi NCR', lat: 28.6, lon: 77.2 };

/** India Standard Time is UTC+05:30 all year. */
const IST_OFFSET_MIN = 330;

/** Refraction and the sun's radius put sunrise and sunset at this altitude. */
export const HORIZON = -0.833;

const norm = (deg: number) => ((deg % 360) + 360) % 360;

export interface SunPoint {
  /** Degrees above the horizon (negative below). */
  alt: number;
  /** Degrees clockwise from north. */
  az: number;
}

function declinationAndRa(date: Date): { dec: number; ra: number; d: number } {
  const d = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const L = norm(280.46 + 0.9856474 * d);
  const g = norm(357.528 + 0.9856003 * d) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * d) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG;
  return { dec, ra, d };
}

/** Altitude and azimuth for a declination and hour angle (all in degrees). */
export function horizontal(decDeg: number, hourAngleDeg: number, latDeg = SITE.lat): SunPoint {
  const lat = latDeg * RAD;
  const dec = decDeg * RAD;
  const h = hourAngleDeg * RAD;
  const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(h), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(h) * Math.sin(lat));
  return { alt: alt * DEG, az: norm(az * DEG) };
}

export function sunAt(date: Date, lat = SITE.lat, lon = SITE.lon): SunPoint & { dec: number } {
  const { dec, ra, d } = declinationAndRa(date);
  const gmst = norm(280.46061837 + 360.98564736629 * d);
  const hourAngle = norm(gmst + lon - ra + 180) - 180;
  return { ...horizontal(dec, hourAngle, lat), dec };
}

/** A moment given as an IST calendar day ("2026-11-14") plus minutes after IST midnight. */
export function istMoment(day: string, minutes: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + (minutes - IST_OFFSET_MIN) * 60_000);
}

/** Minutes after IST midnight for a moment. */
export function istMinutes(date: Date): number {
  return (((date.getTime() / 60_000 + IST_OFFSET_MIN) % 1440) + 1440) % 1440;
}

export interface SunDay {
  sunrise: number | null;
  noon: number;
  sunset: number | null;
  /** Highest altitude, at solar noon. */
  peak: number;
  dec: number;
}

/** Rise, noon and set (minutes after IST midnight) for one day, found by sampling every 2 minutes. */
export function sunDay(day: string, lat = SITE.lat, lon = SITE.lon): SunDay {
  const step = 2;
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let noon = 720;
  let peak = -90;
  let prev = sunAt(istMoment(day, 0), lat, lon).alt;
  for (let m = step; m <= 1440; m += step) {
    const alt = sunAt(istMoment(day, m), lat, lon).alt;
    if (prev < HORIZON && alt >= HORIZON && sunrise === null) sunrise = m - step + (step * (HORIZON - prev)) / (alt - prev);
    if (prev >= HORIZON && alt < HORIZON && sunset === null) sunset = m - step + (step * (prev - HORIZON)) / (prev - alt);
    if (alt > peak) {
      peak = alt;
      noon = m;
    }
    prev = alt;
  }
  return { sunrise, noon, sunset, peak, dec: sunAt(istMoment(day, noon), lat, lon).dec };
}

/** "06:43" */
export function clock(minutes: number): string {
  const m = Math.round(minutes) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];

export function compass(az: number): string {
  return COMPASS[Math.round(norm(az) / 22.5) % 16];
}
