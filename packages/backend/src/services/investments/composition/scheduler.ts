import InvestmentFundSnapshots from '@models/investments/fund-holdings-snapshot.model';

import { definitionFor } from './registry';
import {
  getCompositionAttempts,
  getCompositionSchedule,
  ownedCompositionSecurities,
  refreshSecComposition,
} from './service';

let running = false;
/** Existing application scheduler only; never runs during an analytics read. */
export async function runDueCompositionRefreshes() {
  if (running) return { users: 0, imported: 0, duplicates: 0, failed: 0, skipped: true };
  running = true;
  let users = 0,
    imported = 0,
    duplicates = 0,
    failed = 0;
  try {
    const configurations = await InvestmentFundSnapshots.findAll({
      where: { 'data.kind': 'refresh-configuration' },
      attributes: ['userId'],
    });
    for (const userId of new Set(configurations.map((r) => r.userId))) {
      const config = await getCompositionSchedule(userId);
      if (!config?.enabled) continue;
      const [funds, attempts] = await Promise.all([ownedCompositionSecurities(userId), getCompositionAttempts(userId)]);
      const fundIds = funds
        .filter(
          (f) =>
            !f.excludedFromAnalytics &&
            !f.identityConflict &&
            (definitionFor(f.symbol)?.seriesId || f.symbol === 'GLD'),
        )
        .filter((f) => {
          const previous = attempts.find((a) => a.fundId === f.id && a.refreshOrigin === 'scheduled');
          return !previous || Date.now() - Date.parse(previous.attemptedAt) >= 7 * 86400000;
        })
        .map((f) => f.id);
      if (!fundIds.length) continue;
      users++;
      const { results } = await refreshSecComposition({
        userId,
        fundIds,
        contact: config.contact,
        origin: 'scheduled',
      });
      imported += results.filter((r) => r.status === 'imported').length;
      duplicates += results.filter((r) => r.status === 'duplicate').length;
      failed += results.filter((r) => r.status === 'failed').length;
    }
    return { users, imported, duplicates, failed };
  } finally {
    running = false;
  }
}
