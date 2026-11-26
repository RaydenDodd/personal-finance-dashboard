import { createHash } from 'node:crypto';
export interface ReviewFunding {
  id: string;
  date: string;
  amount: number;
  currency: string;
  label: string;
  destinationAccountId?: string;
}
export interface ReviewGroup { id: string; name: string; sourceAccountId: string | null; portfolioIds: string[] }
const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const broker = (name: string) => {
  const v = normalize(name);
  if (/^m1(?: finance| group| invest(?: \d+)?| roth ira| traditional ira)?$/.test(v)) return 'm1';
  if (/^robinhood(?: financial| securities| group| \d+)?$/.test(v)) return 'robinhood';
  if (/^public(?:\.com)?$/.test(v)) return 'public';
  return null;
};
export function matchReviewGroup(entry: ReviewFunding, groups: ReviewGroup[], sourceNames: Map<string,string>, portfolioId?: string) {
  if (portfolioId) return groups.find(g => g.portfolioIds.includes(portfolioId));
  if (entry.destinationAccountId) return groups.find(g => g.sourceAccountId === entry.destinationAccountId);
  const alias = broker(entry.label);
  // Only a unique known broker alias is a suggestion; never assign a member from a name.
  if (!alias) return undefined;
  const matches = groups.filter(g => g.sourceAccountId && (broker(g.name) === alias || broker(sourceNames.get(g.sourceAccountId) ?? '') === alias));
  return matches.length === 1 ? matches[0] : undefined;
}
export function reviewFingerprint(entry: ReviewFunding, group: ReviewGroup) {
  return createHash('sha256').update(JSON.stringify([entry.id,entry.date,entry.amount,entry.currency,group.id,group.sourceAccountId,[...group.portfolioIds].sort()])).digest('hex');
}
export function coveredAmount(amount: number, purchases: number[], cashRetained: boolean) {
  const cents = Math.round(amount * 100);
  const spent = purchases.reduce((sum,n) => sum + Math.round(n * 100),0);
  return cashRetained || (spent > 0 && spent >= cents - 1);
}
