<script setup lang="ts">
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { ArrowLeftIcon } from '@lucide/vue';
import { ROUTES_NAMES } from '@/routes';
import { useRoute, useRouter } from 'vue-router';
import { computed } from 'vue';
import IncomeSettings from './taxes.vue';
import { usePayroll } from './payroll/use-payroll';

const route = useRoute(),
  router = useRouter(),
  payroll = usePayroll();
const planId = computed(() => (typeof route.query.plan === 'string' ? route.query.plan : undefined));
const initialSection = computed(() => (typeof route.query.section === 'string' ? route.query.section : undefined));
const latestPayroll = computed(() =>
  [...(payroll.data.value?.statements ?? [])]
    .filter((s) => s.regularRate !== null && !s.adjustment && s.totals.regular > 0)
    .at(-1),
);
const close = () => router.push({ name: ROUTES_NAMES.projectedIncome });
</script>
<template>
  <PageWrapper>
    <div class="mx-auto w-full max-w-5xl space-y-5 py-4 md:py-6" data-testid="projection-editor">
      <header class="space-y-3">
        <Button as-child variant="ghost" size="sm" class="-ml-3"
          ><router-link :to="{ name: ROUTES_NAMES.projectedIncome }"
            ><ArrowLeftIcon class="mr-2 size-4" />Projected Income</router-link
          ></Button
        >
        <div>
          <h1 class="text-2xl font-semibold">Edit projections</h1>
          <p class="text-muted-foreground mt-1 text-sm">
            Continue through each section, or click a section to edit it. Save when you’re finished.
          </p>
        </div>
      </header>
      <IncomeSettings
        :plan-id="planId"
        :initial-section="initialSection"
        :payroll-salary="payroll.data.value?.summary.currentSalary"
        :payroll-retirement="latestPayroll?.totals"
        @saved="close"
        @cancel="close"
      />
    </div>
  </PageWrapper>
</template>
