import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { brokerDataSchema } from '@services/investments/broker-records/schema';
import { getBrokerData, saveBrokerData } from '@services/investments/broker-records/service';
import { z } from 'zod';

const portfolioParams = z.object({ id: recordId() });
export const getBrokerRecords = createController(z.object({ params: portfolioParams }), async ({ user, params }) => ({
  data: await getBrokerData({ userId: user.id, portfolioId: params.id }),
}));
export const importBrokerRecords = createController(
  z.object({ params: portfolioParams, body: brokerDataSchema }),
  async ({ user, params, body }) => ({
    data: await saveBrokerData({ userId: user.id, portfolioId: params.id, data: body }),
  }),
);
