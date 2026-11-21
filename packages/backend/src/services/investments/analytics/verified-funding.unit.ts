import { brokerDataSchema } from '../broker-records/schema';
import { verifiedFunding } from './verified-funding';

describe('verified external funding coverage', () => {
  const deposit = 'a'.repeat(64),
    returned = 'b'.repeat(64),
    document = 'd'.repeat(64);
  const data = () =>
    brokerDataSchema.parse({
      broker: 'm1',
      accountKey: 'example',
      documents: [{ name: 'activity.csv', sha256: document }],
      historyComplete: false,
      fundingCoverage: {
        from: '2022-06-09',
        through: '2026-11-21',
        sourceRowIds: [deposit, returned],
        netContributions: '19787.33',
        documentSha256: document,
        verified: true,
      },
    });
  const rows = () => [
    { date: '2022-06-09', amount: '19975.33', description: `[broker-row:${deposit}] completed deposits` },
    { date: '2024-11-19', amount: '-188', description: `[broker-row:${returned}] returned deposit` },
  ];
  it('accepts a net source control independently of incomplete holdings history', () =>
    expect(verifiedFunding(data(), rows(), '2026-11-21')).toBe(true));
  it('rejects a missing reversal, changed control, duplicate reference or unlisted external movement', () => {
    expect(verifiedFunding(data(), rows().slice(0, 1), '2026-11-21')).toBe(false);
    expect(
      verifiedFunding(
        { ...data(), fundingCoverage: { ...data().fundingCoverage!, netContributions: '19975.33' } },
        rows(),
        '2026-11-21',
      ),
    ).toBe(false);
    expect(verifiedFunding(data(), [rows()[0]!, rows()[0]!], '2026-11-21')).toBe(false);
    expect(
      verifiedFunding(data(), [...rows(), { date: '2026-11-21', amount: '1', description: 'unlisted' }], '2026-11-21'),
    ).toBe(false);
  });
});
