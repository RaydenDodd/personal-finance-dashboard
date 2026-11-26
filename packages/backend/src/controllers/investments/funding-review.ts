import { previewFundingCsv, applyFundingCsv } from '@services/investments/funding-review-csv';
import { nativeFundingOptions, recordNativeFunding } from '@services/investments/funding-review-native';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getFundingReviews,listReviewPurchases,resolveFundingReview,snoozeFundingReminder } from '@services/investments/funding-review';
import { z } from 'zod';
const params=z.object({id:recordId()});
export const listFundingReviews=createController(z.object({}),async({user})=>({data:await getFundingReviews(user.id)}));
export const getFundingReviewPurchases=createController(z.object({params,query:z.object({portfolioId:recordId()})}),async({user,params,query})=>({data:await listReviewPurchases(user.id,params.id,query.portfolioId)}));
export const resolveReview=createController(z.object({params,body:z.object({portfolioId:recordId(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),tradeIds:z.array(recordId()).max(100),cashRetained:z.boolean()})}),async({user,params,body})=>({data:await resolveFundingReview(user.id,params.id,body)}));
export const snoozeReviewReminder=createController(z.object({}),async({user})=>({data:await snoozeFundingReminder(user.id)}));

const csvBody=z.object({portfolioId:recordId(),fileContent:z.string().min(1).max(600000)});
export const previewReviewCsv=createController(z.object({params,body:csvBody}),async({user,params,body})=>({data:await previewFundingCsv(user.id,params.id,body)}));
export const applyReviewCsv=createController(z.object({params,body:csvBody.extend({fileHash:z.string().regex(/^[a-f0-9]{64}$/),sourceRowIds:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50),confirmCash:z.literal(true)})}),async({user,params,body})=>({data:await applyFundingCsv(user.id,params.id,body)}));

export const getNativeFundingOptions=createController(z.object({params,query:z.object({portfolioId:recordId()})}),async({user,params,query})=>({data:await nativeFundingOptions(user.id,params.id,query.portfolioId)}));
export const recordReviewFunding=createController(z.object({params,body:z.object({portfolioId:recordId(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['existing','add-cash','historical']),transferId:recordId().optional()})}),async({user,params,body})=>({data:await recordNativeFunding(user.id,params.id,body)}));
