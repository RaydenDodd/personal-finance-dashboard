<script setup lang="ts">
import { api } from '@/api/_api';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { ROUTES_NAMES } from '@/routes/constants';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { FolderPlusIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';

interface Group {
  id: string;
  name: string;
  sourceAccountId: string | null;
  portfolioIds: string[];
}
interface GroupData {
  groups: Group[];
  sourceAccounts: { id: string; name: string; currencyCode: string; providerName: string; isActive: boolean }[];
  portfolios: { id: string; name: string; isEnabled: boolean }[];
}
const client = useQueryClient();
const query = useQuery({
  queryKey: ['investment-account-groups'],
  queryFn: () => api.get('/investments/groups') as Promise<GroupData>,
});
const data = computed(() => query.data.value);
const groups = computed(() => data.value?.groups ?? []);
const portfolioName = (id: string) => data.value?.portfolios.find(p => p.id === id)?.name ?? 'Unavailable portfolio';
const sourceName = (id: string | null) => id ? data.value?.sourceAccounts.find(a => a.id === id)?.name ?? 'Connection unavailable — review mapping' : 'No SimpleFIN account';
const open = ref(false);
const editing = ref<string | null>(null);
const name = ref('');
const source = ref('');
const members = ref<string[]>([]);
const deleting = ref(false);
const busy = ref(false);
const error = ref('');
const occupied = computed(() => new Set(groups.value.filter(g => g.id !== editing.value).flatMap(g => g.portfolioIds)));
const occupiedSources = computed(() => new Set(groups.value.filter(g => g.id !== editing.value).map(g => g.sourceAccountId)));
function edit(group?: Group) {
  editing.value = group?.id ?? null;
  name.value = group?.name ?? '';
  source.value = group?.sourceAccountId ?? '';
  members.value = [...(group?.portfolioIds ?? [])];
  deleting.value = false;
  error.value = '';
  open.value = true;
}
async function refresh() {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['investment-account-groups'] }),
    client.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange, 'calendar-funding'] }),
  ]);
}
async function save() {
  if (busy.value || !name.value.trim() || !members.value.length) return;
  busy.value = true; error.value = '';
  try {
    const payload = {name:name.value.trim(), sourceAccountId:source.value || null, portfolioIds:members.value};
    if (editing.value) await api.put('/investments/groups/' + editing.value, payload);
    else await api.post('/investments/groups', payload);
    open.value = false;
    await refresh();
  } catch { error.value = 'Could not save the group. Check that the selected portfolios and source are available.'; }
  finally { busy.value = false; }
}
async function remove() {
  if (!editing.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    await api.delete('/investments/groups/' + editing.value);
    open.value = false;
    await refresh();
  } catch { error.value = 'Could not delete the group.'; }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="mb-6 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Investment groups</h2>
      <Button variant="outline" :disabled="!data" @click="edit()"><FolderPlusIcon class="size-4"/> Create group</Button>
    </div>
    <p class="text-muted-foreground text-xs">Organize portfolios by brokerage and map a shared SimpleFIN account. Grouping does not change balances or existing net-worth exclusions.</p>
    <p v-if="query.isPending.value" class="text-muted-foreground text-sm">Loading investment groups…</p>
    <div v-else-if="query.isError.value" class="flex items-center gap-2 text-sm" role="alert">
      Unable to load investment groups. <Button size="sm" variant="outline" @click="query.refetch()">Retry</Button>
    </div>
    <p v-else-if="!groups.length" class="text-muted-foreground rounded-md border border-dashed p-4 text-sm">No groups yet. Create a group for a brokerage such as M1 or Robinhood.</p>
    <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
      <Card v-for="group in groups" :key="group.id">
        <CardHeader class="flex flex-row items-center justify-between gap-2 p-4 pb-2">
          <h3 class="min-w-0 truncate font-semibold">{{ group.name }}</h3>
          <Button variant="ghost" size="icon-sm" :aria-label="'Edit ' + group.name" @click="edit(group)"><PencilIcon class="size-4"/></Button>
        </CardHeader>
        <CardContent class="space-y-2 p-4 pt-1 text-sm">
          <p class="text-muted-foreground text-xs">SimpleFIN: {{ sourceName(group.sourceAccountId) }}</p>
          <RouterLink v-for="id in group.portfolioIds" :key="id" :to="{name:ROUTES_NAMES.portfolioDetail,params:{portfolioId:id}}" class="block rounded border px-3 py-2 hover:bg-muted/50">{{ portfolioName(id) }}</RouterLink>
          <p v-if="!group.portfolioIds.length" class="text-muted-foreground text-xs">No active member portfolios.</p>
        </CardContent>
      </Card>
    </div>
    <Dialog v-model:open="open">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editing ? 'Edit investment group' : 'Create investment group' }}</DialogTitle>
          <DialogDescription>One source account may represent multiple portfolios. No money moves when you save.</DialogDescription>
        </DialogHeader>
        <ScrollArea class="min-h-0 max-h-[60vh]" viewport-class="pr-3">
          <form class="space-y-4" @submit.prevent="save">
            <label class="block space-y-1 text-sm"><span>Group name</span><input v-model="name" required maxlength="100" class="bg-background block w-full rounded-md border p-2" placeholder="M1 Finance"/></label>
            <label class="block space-y-1 text-sm"><span>SimpleFIN account (optional)</span>
              <select v-model="source" class="bg-background block w-full rounded-md border p-2">
                <option value="">No connected account</option>
                <option v-if="source && !data?.sourceAccounts.some(a=>a.id===source)" :value="source" disabled>Unavailable source — select a new account or unlink</option>
                <option v-for="account in data?.sourceAccounts ?? []" :key="account.id" :value="account.id" :disabled="occupiedSources.has(account.id)">
                  {{ account.name }} · {{ account.currencyCode }}{{ account.isActive ? '' : ' (inactive)' }}{{ occupiedSources.has(account.id) ? ' — already mapped' : '' }}
                </option>
              </select>
            </label>
            <fieldset class="space-y-2">
              <legend class="mb-2 text-sm font-medium">Member portfolios</legend>
              <label v-for="portfolio in data?.portfolios ?? []" :key="portfolio.id" class="flex items-center gap-2 rounded border p-2 text-sm" :class="occupied.has(portfolio.id) ? 'opacity-50' : ''">
                <input v-model="members" type="checkbox" :value="portfolio.id" :disabled="occupied.has(portfolio.id)" />
                <span>{{ portfolio.name }} <span v-if="!portfolio.isEnabled" class="text-muted-foreground text-xs">(excluded from net worth)</span><span v-if="occupied.has(portfolio.id)" class="text-muted-foreground text-xs"> — already grouped</span></span>
              </label>
            </fieldset>
            <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
            <div v-if="deleting" class="space-y-2 rounded border p-3 text-sm">
              <p>Delete this group? Portfolios, transactions and balances are preserved.</p>
              <div class="flex gap-2"><Button type="button" variant="destructive" :disabled="busy" @click="remove">Confirm delete</Button><Button type="button" variant="outline" @click="deleting=false">Cancel</Button></div>
            </div>
            <div v-else class="flex flex-wrap justify-between gap-2">
              <Button v-if="editing" type="button" variant="ghost" :disabled="busy" @click="deleting=true"><Trash2Icon class="size-4"/> Delete group</Button>
              <Button type="submit" class="ml-auto" :disabled="busy || !name.trim() || !members.length">Save group</Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </section>
</template>
