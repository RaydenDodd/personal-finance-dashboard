import { coveredAmount, matchReviewGroup, reviewFingerprint } from './funding-review-model';
const a={id:'a',name:'M1 Finance',sourceAccountId:'source',portfolioIds:['p','q']};
const e={id:'tx',date:'2026-11-21',amount:200,currency:'USD',label:'M1'};
describe('investment funding reviews',()=>{
  it('uses explicit destination or portfolio before a unique broker alias',()=>{
    expect(matchReviewGroup(e,[a],new Map())?.id).toBe('a');
    expect(matchReviewGroup({...e,destinationAccountId:'other'},[a],new Map())).toBeUndefined();
    expect(matchReviewGroup({...e,label:'Other'},[a],new Map(),'q')?.id).toBe('a');
    expect(matchReviewGroup(e,[a,{...a,id:'b',sourceAccountId:'second'}],new Map())).toBeUndefined();
  });
  it('requires reviewed purchases or retained cash and never guesses by amount alone',()=>{
    expect(coveredAmount(200,[],false)).toBe(false);
    expect(coveredAmount(200,[100],false)).toBe(false);
    expect(coveredAmount(200,[100],true)).toBe(true);
    expect(coveredAmount(200,[54.98,104.92,40.11],false)).toBe(true);
  });
  it('changes review identity if source amount or group membership changes',()=>{
    expect(reviewFingerprint(e,a)).not.toBe(reviewFingerprint({...e,amount:201},a));
    expect(reviewFingerprint(e,a)).not.toBe(reviewFingerprint(e,{...a,portfolioIds:['p']}));
  });
});
