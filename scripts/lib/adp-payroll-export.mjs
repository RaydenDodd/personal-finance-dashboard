/** Executes entirely inside the owner's authenticated MyADP page. Do not add closure dependencies. */
export async function collectAdpPayroll({ workerId, pauseMs = 750, timeoutMs = 30_000 }) {
  if (!/^[a-zA-Z0-9._~-]{1,250}$/.test(workerId)) throw new Error('No valid worker ID supplied. Nothing exported.');
  const base = `/myadp_prefix/payroll/v1/workers/${encodeURIComponent(workerId)}/pay-statements`;
  const get = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          `ADP returned HTTP ${response.status}. Export stopped; reauthenticate or retry later yourself.`,
        );
      if (!(response.headers.get('content-type') ?? '').includes('json'))
        throw new Error('ADP did not return JSON; export stopped.');
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const history = await get(base + '?adjustments=yes&numberoflastpaydates=160');
  const rows = history?.payStatements ?? history?.payStatementList ?? history?.payStatementHistory ?? history;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500)
    throw new Error('Unrecognized or empty ADP history format. Export stopped without guessing.');
  const ids = rows.map((row) => {
    const explicit = row.payStatementID ?? row.payStatementId ?? row.statementId ?? row.id;
    let fromUri;
    if (row.payDetailUri?.href) {
      const url = new URL(row.payDetailUri.href, 'https://my.adp.com');
      // The owner's real history export supplies IDs in payDetailUri.href, not a statementId field.
      const plainBase = `/payroll/v1/workers/${encodeURIComponent(workerId)}/pay-statements/`;
      const prefixBase = base + '/';
      const prefix = url.pathname.startsWith(prefixBase) ? prefixBase : plainBase;
      if (url.origin !== 'https://my.adp.com' || !url.pathname.startsWith(prefix))
        throw new Error('ADP statement link is outside the selected employee history. Export stopped.');
      const tail = url.pathname.slice(prefix.length);
      if (!tail || tail.includes('/')) throw new Error('ADP statement link is invalid. Export stopped.');
      fromUri = decodeURIComponent(tail);
    }
    if (explicit !== undefined && fromUri !== undefined && explicit !== fromUri)
      throw new Error('ADP statement identity conflict. Export stopped.');
    const id = explicit ?? fromUri;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._~-]{1,250}$/.test(id))
      throw new Error('Missing or invalid statement identity; inspect your downloaded history.');
    return id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate statement identities; inspect your downloaded history.');
  const payStatements = [];
  for (const [index, id] of ids.entries()) {
    const detail = await get(base + '/' + encodeURIComponent(id));
    const raw =
      detail?.payStatement ??
      (Array.isArray(detail?.payStatements) && detail.payStatements.length === 1 ? detail.payStatements[0] : detail);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.payDate !== 'string')
      throw new Error('Unrecognized ADP statement format. Export stopped without guessing.');
    if (raw.statementId !== undefined && raw.statementId !== id)
      throw new Error('ADP statement identity conflict. Export stopped.');
    // MyADP provides adjustment status in history, while its detail JSON may omit it.
    // Preserve both true and false; never turn an omitted flag into a reversal of history.
    const summaryAdjustment = rows[index].payAdjustmentIndicator;
    const detailAdjustment = raw.payAdjustmentIndicator;
    for (const value of [summaryAdjustment, detailAdjustment])
      if (value !== undefined && typeof value !== 'boolean')
        throw new Error('ADP adjustment status is invalid. Export stopped.');
    if (summaryAdjustment !== undefined && detailAdjustment !== undefined && summaryAdjustment !== detailAdjustment)
      throw new Error('ADP adjustment status conflict. Export stopped.');
    const adjustment = detailAdjustment ?? summaryAdjustment;
    if (adjustment === undefined) throw new Error('ADP adjustment status is missing. Export stopped without guessing.');
    // The requested detail URL provides identity; history supplies omitted adjustment metadata.
    const payrollFields = [
      'payDate',
      'payPeriod',
      'netPayAmount',
      'grossPayAmount',
      'grossPayYTDAmount',
      'totalHours',
      'earnings',
      'deductionCategoryDetails',
      'deductions',
      'memos',
    ];
    payStatements.push({
      ...Object.fromEntries(payrollFields.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]])),
      statementId: id,
      payAdjustmentIndicator: adjustment,
    });
    if (index + 1 < ids.length) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  // Matches the already verified detailed-export schema; do not emit browser/session metadata.
  return {
    exportedAt: new Date().toISOString(),
    expectedStatements: ids.length,
    downloadedStatements: payStatements.length,
    failures: [],
    payStatements,
  };
}

/** No browser profile, authentication state, trace, HAR, cookie export or credentials are persisted. */
export async function withTemporaryAdpBrowser(chromium, channel, run) {
  let browser, context;
  try {
    browser = await chromium.launch({ headless: false, ...(channel === 'chromium' ? {} : { channel }) });
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    return await run(context);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
