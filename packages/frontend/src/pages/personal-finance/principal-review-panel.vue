<script setup lang="ts">
import {
  confirmPrincipalDestination,
  getFinancePrincipalState,
  reconcilePrincipalTransactions,
  type FinanceAccount,
  type PrincipalReview,
} from '@/api/personal-finance';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
const props = defineProps<{ accounts: FinanceAccount[] }>();
const emit = defineEmits<{ updated: []; record: [accountId: string, date: string] }>();
const reviews = ref<PrincipalReview[]>([]);
const destinations = ref<Record<string, string>>({});
const busy = ref(false);
const error = ref('');
const tracked = computed(() =>
  props.accounts.filter((account) => ['savings', 'investments', 'retirement'].includes(account.categoryId)),
);
async function refresh() {
  try {
    reviews.value = (await getFinancePrincipalState()).reviews;
  } catch {
    /* Existing manual records remain available when review service is unavailable. */
  }
}
async function confirm(review: PrincipalReview) {
  const destinationAccountId = destinations.value[review.id];
  const { sourceNativeAccountId, exactDescription, transactionId } = review.details;
  if (!destinationAccountId || !sourceNativeAccountId || !exactDescription || !transactionId || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await confirmPrincipalDestination({
      sourceNativeAccountId,
      destinationAccountId,
      exactDescription,
      effectiveFrom: review.details.date && review.details.date >= '2026-11-05' ? review.details.date : '2026-11-05',
      isEnabled: true,
    });
    await reconcilePrincipalTransactions([transactionId]);
    await refresh();
    emit('updated');
  } catch {
    error.value = 'The destination could not be confirmed. The original records remain available.';
  } finally {
    busy.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    if (!document.hidden) void refresh();
  }, 60000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
<template>
  <Card v-if="reviews.length" class="p-4 sm:p-5">
    <details>
      <summary class="cursor-pointer text-sm font-medium">
        Contribution review · {{ reviews.length }} items need verification
      </summary>
      <p class="text-muted-foreground mt-3 text-xs">
        Unverified amounts are excluded from contributed principal. Confirm a transfer destination to reuse that match
        for future imports.
      </p>
      <p v-if="error" role="alert" class="text-destructive mt-3 text-sm">{{ error }}</p>
      <div v-for="review in reviews" :key="review.id" class="mt-4 grid gap-2 border-t pt-3 text-sm">
        <p class="font-medium">{{ review.reason }}</p>
        <p class="text-muted-foreground text-xs">
          {{ review.details.expectedPayDate ?? review.details.date ?? '' }} {{ review.details.note ?? '' }}
        </p>
        <div
          v-if="review.details.sourceNativeAccountId && review.details.transactionId && review.details.exactDescription"
          class="flex flex-wrap items-center gap-2"
        >
          <select
            v-model="destinations[review.id]"
            :aria-label="`Destination for ${review.details.exactDescription}`"
            class="bg-background h-9 max-w-full rounded-md border px-3 text-sm"
          >
            <option disabled value="">Choose verified destination</option>
            <option v-for="account in tracked" :key="account.id" :value="account.id">{{ account.name }}</option>
          </select>
          <Button size="sm" variant="outline" :disabled="busy || !destinations[review.id]" @click="confirm(review)"
            >Confirm destination</Button
          >
        </div>
        <Button
          v-else-if="review.details.accountId"
          size="sm"
          variant="outline"
          class="w-fit"
          @click="emit('record', review.details.accountId, review.details.expectedPayDate ?? review.details.date ?? '')"
          >Record verified contribution</Button
        >
      </div>
    </details>
  </Card>
</template>
