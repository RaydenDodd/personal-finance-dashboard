import { createController } from '@controllers/helpers/controller-factory';
import { configurePublic, publicStatus, syncPublic } from '@services/investments/broker-records/public-sync';
import { z } from 'zod';

export const getPublicStatus = createController(z.object({}), async ({ user }) => ({
  data: await publicStatus(user.id),
}));
export const connectPublic = createController(
  z.object({ body: z.object({ secret: z.string().trim().min(20).max(10000) }) }),
  async ({ user, body }) => ({ data: await configurePublic(user.id, body.secret) }),
);
export const refreshPublic = createController(z.object({}), async ({ user }) => ({ data: await syncPublic(user.id) }));
