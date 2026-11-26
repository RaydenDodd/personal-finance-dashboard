<script setup lang="ts">
import { api } from '@/api/_api';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { ROUTES_NAMES } from '@/routes/constants';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { FolderPlusIcon, PencilIcon, Trash2Icon, RefreshCwIcon } from '@lucide/vue';
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
    client.invalidateQueries({ queryKey: ['investment-funding-reviews'] }),
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
  <section class="mb-4 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Investment groups</h2>
      <Button variant="outline" size="sm" :disabled="!data" aria-label="Create group" title="Create group" @click="edit()"><FolderPlusIcon class="size-4"/><span class="hidden sm:inline">Create group</span></Button>
    </div>
    <p v-if="query.isPending.value" class="text-muted-foreground text-sm">Loading investment groups…</p>
    <div v-else-if="query.isError.value" class="flex items-center gap-2 text-sm" role="alert">
      Unable to load groups. <Button size="icon-sm" variant="outline" aria-label="Retry" title="Retry" @click="query.refetch()"><RefreshCwIcon class="size-4"/></Button>
    </div>
    <p v-else-if="!groups.length" class="text-muted-foreground text-xs">No groups</p>
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
      <DialogContent class="h-[min(88dvh,44rem)] max-h-[88dvh] min-h-0 gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{{ editing ? 'Edit investment group' : 'Create investment group' }}</DialogTitle>
          <DialogDescription class="sr-only">Choose a source account and member portfolios. Balances are unchanged.</DialogDescription>
        </DialogHeader>
        <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="save">
          <ScrollArea class="min-h-0 flex-1 basis-0" viewport-class="pr-3" type="auto">
            <div class="space-y-3 pb-2">
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
              <label v-for="portfolio in data?.portfolios ?? []" :key="portfolio.id" class="flex cursor-pointer items-center gap-2 rounded border p-2 text-sm" :class="occupied.has(portfolio.id) ? 'opacity-50' : ''">
                <input v-model="members" type="checkbox" class="size-4 shrink-0 accent-primary" :value="portfolio.id" :disabled="occupied.has(portfolio.id)" />
                <span>{{ portfolio.name }} <span v-if="!portfolio.isEnabled" class="text-muted-foreground text-xs">(excluded from net worth)</span><span v-if="occupied.has(portfolio.id)" class="text-muted-foreground text-xs"> — already grouped</span></span>
              </label>
            </fieldset>
            </div>
          </ScrollArea>
          <p v-if="error" class="text-destructive shrink-0 text-sm" role="alert">{{ error }}</p>
          <DialogFooter class="shrink-0 border-t pt-3">
            <div v-if="deleting" class="space-y-2 rounded border p-3 text-sm">
              <p>Delete this group? Portfolios, transactions and balances are preserved.</p>
              <div class="flex gap-2"><Button type="button" variant="destructive" :disabled="busy" @click="remove">Confirm delete</Button><Button type="button" variant="outline" @click="deleting=false">Cancel</Button></div>
            </div>
            <div v-else class="flex w-full items-center justify-between gap-2">
              <Button v-if="editing" type="button" variant="ghost" :disabled="busy" aria-label="Delete group" title="Delete group" @click="deleting=true"><Trash2Icon class="size-4"/><span class="hidden sm:inline">Delete group</span></Button>
              <Button type="submit" class="ml-auto" :disabled="busy || !name.trim() || !members.length">Save group</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
