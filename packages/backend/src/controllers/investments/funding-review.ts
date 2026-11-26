import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getFundingReviews,listReviewPurchases,resolveFundingReview,snoozeFundingReminder } from '@services/investments/funding-review';
import { z } from 'zod';
const params=z.object({id:recordId()});
export const listFundingReviews=createController(z.object({}),async({user})=>({data:await getFundingReviews(user.id)}));
export const getFundingReviewPurchases=createController(z.object({params,query:z.object({portfolioId:recordId()})}),async({user,params,query})=>({data:await listReviewPurchases(user.id,params.id,query.portfolioId)}));
export const resolveReview=createController(z.object({params,body:z.object({portfolioId:recordId(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),tradeIds:z.array(recordId()).max(100),cashRetained:z.boolean()})}),async({user,params,body})=>({data:await resolveFundingReview(user.id,params.id,body)}));
export const snoozeReviewReminder=createController(z.object({}),async({user})=>({data:await snoozeFundingReminder(user.id)}));
