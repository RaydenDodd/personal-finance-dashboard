import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteInvestmentGroup, listInvestmentGroups, saveInvestmentGroup } from '@services/investments/groups';
import { z } from 'zod';

const params = z.object({ id: recordId() });
const body = z.object({
  name: z.string().trim().min(1).max(100),
  sourceAccountId: recordId().nullable(),
  portfolioIds: z.array(recordId()).min(1).max(100),
});
export const listGroups = createController(z.object({}), async ({ user }) => ({ data: await listInvestmentGroups(user.id) }));
export const createGroup = createController(z.object({ body }), async ({ user, body }) => ({ data: await saveInvestmentGroup(user.id, body), statusCode: 201 }));
export const updateGroup = createController(z.object({ params, body }), async ({ user, params, body }) => ({ data: await saveInvestmentGroup(user.id, body, params.id) }));
export const deleteGroup = createController(z.object({ params }), async ({ user, params }) => ({ data: await deleteInvestmentGroup(user.id, params.id) }));
