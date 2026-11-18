// One-time owner-authorized enrichment. No transaction creation or category writes.
const crypto = require('node:crypto');
const { Client } = require('pg');
async function main() {
  const env = process.env;
  const db = new Client({
    host: env.APPLICATION_DB_HOST || 'db',
    port: Number(env.APPLICATION_DB_PORT || 5432),
    user: env.APPLICATION_DB_USERNAME,
    database: env.APPLICATION_DB_DATABASE,
    password: env.APPLICATION_DB_PASSWORD,
  });
  await db.connect();
  try {
    const { rows } = await db.query(
      'SELECT id, credentials FROM "BankDataProviderConnections" WHERE "providerType"=$1 AND "userId"=$2 AND "isActive"=true',
      ['simplefin', 1],
    );
    if (rows.length !== 1) throw Error('Ambiguous connection');
    const [iv, tag, data] = rows[0].credentials.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(env.APPLICATION_JWT_SECRET).digest(),
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const credentials = JSON.parse(decipher.update(data, 'hex', 'utf8') + decipher.final('utf8'));
    const url = new URL(credentials.accessUrl);
    const auth = Buffer.from(decodeURIComponent(url.username) + ':' + decodeURIComponent(url.password)).toString(
      'base64',
    );
    url.username = '';
    url.password = '';
    url.pathname = url.pathname.replace(/\/$/, '') + '/accounts';
    url.searchParams.set('version', '2');
    url.searchParams.set('start-date', String(Math.floor(Date.now() / 1000) - 43 * 86400));
    url.searchParams.set('pending', '1');
    const response = await fetch(url, {
      headers: { Authorization: 'Basic ' + auth },
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error('Provider unavailable');
    const payload = await response.json();
    const accounts = (
      await db.query(
        'SELECT id, "externalId" FROM "Accounts" WHERE "bankDataProviderConnectionId"=$1 AND "userId"=$2',
        [rows[0].id, 1],
      )
    ).rows;
    const checksum = async () =>
      (
        await db.query(
          `SELECT md5(string_agg((to_jsonb(t)-'externalData')::text || (COALESCE("externalData",'{}'::jsonb)-'mcc')::text, '' ORDER BY id)) AS hash, count(*) AS count FROM "Transactions" t WHERE "userId"=1`,
        )
      ).rows[0];
    await db.query('BEGIN');
    const before = await checksum();
    let changed = 0,
      supplied = 0;
    for (const account of payload.accounts || []) {
      const local = accounts.find((a) => a.externalId === account.id);
      if (!local) continue;
      for (const transaction of account.transactions || []) {
        let code = transaction.mcc ?? transaction.extra?.mcc;
        if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 9999)
          code = String(code).padStart(4, '0');
        if (typeof code !== 'string' || !/^\d{4}$/.test(code.trim())) continue;
        code = code.trim();
        supplied++;
        const result = await db.query(
          `UPDATE "Transactions" SET "externalData"=COALESCE("externalData",'{}'::jsonb)||jsonb_build_object('mcc',$1::text)
          WHERE "userId"=1 AND "accountId"=$2 AND ("originalId"=$3 OR "externalData"#>>'{originalSource,originalId}'=$3)
            AND "externalData"->>'mcc' IS DISTINCT FROM $1`,
          [code, local.id, transaction.id],
        );
        changed += result.rowCount;
      }
    }
    const after = await checksum();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Unrelated transaction fields changed');
    await db.query('COMMIT');
    console.log(
      JSON.stringify({
        suppliedCodes: supplied,
        enrichedRows: changed,
        transactionsPreserved: Number(after.count),
        unrelatedFieldsUnchanged: true,
      }),
    );
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error('MCC enrichment failed; transaction changes rolled back; secrets omitted');
  process.exitCode = 1;
});
