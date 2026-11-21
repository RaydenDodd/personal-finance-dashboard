import type Securities from '@models/investments/securities.model';
/** Supplement missing classifications only, using native instrument IDs. Never infer issuer country from headquarters. */
export function fillMissingCompanyClassifications(
  rows: {
    id: string;
    sector?: string;
    industry?: string;
    classificationSources?: Partial<Record<'sector' | 'industry', string>>;
  }[],
  securities: Pick<Securities, 'id' | 'companyClassifications'>[],
) {
  const profiles = new Map(securities.map((s) => [String(s.id), s.companyClassifications]));
  for (const row of rows) {
    const profile = profiles.get(row.id);
    if (!profile?.observedAt) continue;
    for (const key of ['sector', 'industry'] as const) {
      if (row[key] && !(/^unknown\b/i.test(row[key]!) && !/conflicting/i.test(row[key]!))) continue;
      if (profile[key]) {
        row[key] = `Yahoo Finance · ${profile[key]}`;
        row.classificationSources = {
          ...row.classificationSources,
          [key]: `${profile.source} · observed ${profile.observedAt} · ${profile.sourceUrl}`,
        };
      }
    }
  }
}
