import { area, line, scaleLinear } from 'd3';
export function buildPaceGeometry({
  width,
  height,
  actual,
  comparison,
  forecast,
  todayIndex,
  days,
  spikeDays = [],
}: {
  width: number;
  height: number;
  actual: (number | null)[];
  comparison: (number | null)[] | null;
  forecast: (number | null)[] | null;
  todayIndex: number;
  days: number;
  spikeDays?: number[];
}) {
  if (width <= 0 || height <= 4) return null;
  const values = [...actual, ...(comparison ?? []), ...(forecast ?? [])].filter((v): v is number => v !== null);
  const top = Math.max(0, ...values) * 1.08 || 1,
    bottom = Math.min(0, ...values) * 1.08;
  const x = scaleLinear()
      .domain([0, Math.max(1, days - 1)])
      .range([0, width]),
    y = scaleLinear().domain([bottom, top]).range([height, 4]);
  const toLine = line<number | null>()
    .defined((v) => v !== null)
    .x((_, i) => x(i))
    .y((v) => y(v ?? 0));
  return {
    x,
    ticks: y
      .ticks(3)
      .filter((v) => v > bottom && v < top)
      .map((value) => ({ value, y: y(value) })),
    spentArea: area<number | null>()
      .defined((v) => v !== null)
      .x((_, i) => x(i))
      .y0(y(0))
      .y1((v) => y(v ?? 0))(actual),
    spentLine: toLine(actual),
    comparisonLine: comparison ? toLine(comparison) : null,
    forecastLine: forecast ? toLine(forecast) : null,
    todayDot: todayIndex >= 0 && actual[todayIndex] != null ? { x: x(todayIndex), y: y(actual[todayIndex]!) } : null,
    forecastDot: forecast?.at(-1) != null ? { x: width, y: y(forecast.at(-1)!) } : null,
    spikeMarks: spikeDays.map((day) => ({ day, x: x(day), y: y(forecast?.[day] ?? 0) })),
  };
}
export type PaceGeometry = NonNullable<ReturnType<typeof buildPaceGeometry>>;
