<script setup lang="ts">
import { api } from '@/api/_api';
import { Button } from '@/components/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useIdleEnabled } from '@/composable/use-idle-enabled';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore,useRootStore,useUserStore } from '@/stores';
import { useQuery,useQueryClient } from '@tanstack/vue-query';
import { computed,ref,watch } from 'vue';
import { RefreshCwIcon, ClipboardCheckIcon, PlusIcon, ClockIcon, ArrowRightIcon, XIcon, CheckIcon } from '@lucide/vue';
import { useRoute,useRouter } from 'vue-router';

interface Item {id:string;date:string;amount:number;currency:string;label:string;groupName:string;portfolioId:string|null;nativeTransferId:string|null;portfolios:{id:string;name:string}[];fingerprint:string;reason:string}
interface NativeFunding {linked:boolean;conflict:boolean;candidates:{id:string;portfolioId:string;date:string;amount:number;affectsCash:boolean;description:string}[]}
interface Purchase {id:string;symbol:string;date:string;quantity:string;amount:number;currency:string;alreadyLinked:boolean}
interface CsvRow {sourceRowId:string;date:string;symbol:string;quantity:string;amount:string;status:'existing'|'new'|'review';tradeId:string|null;reason:string}
interface CsvPreview {fileHash:string;totalRows:number;matched:number;newBuys:number;review:number;otherRows:number;depositMatches:number;depositStatus:'unique'|'ambiguous'|'missing';rows:CsvRow[];issues:string[]}
interface Response {items:Item[];reminderDue:boolean;lookbackFrom:string}
const props=defineProps<{reminder?:boolean}>();
const auth=useAuthStore(),root=useRootStore(),user=useUserStore(),route=useRoute(),router=useRouter();
const idle=useIdleEnabled(),client=useQueryClient();
const userId=computed(()=>user.user?.id);
const query=useQuery({queryKey:computed(()=>['investment-funding-reviews',userId.value]),queryFn:()=>api.get('/investments/funding-reviews') as Promise<Response>,enabled:computed(()=>!!auth.isLoggedIn&&root.isAppInitialized&&userId.value!=null&&!user.isDemo&&(!props.reminder||idle.value)),staleTime:60000});
const items=computed(()=>query.data.value?.items??[]);
const open=ref(false),shown=ref(false),busy=ref(false),error=ref('');
const selected=ref<Item|null>(null),portfolio=ref(''),chosen=ref<string[]>([]),cash=ref(false);
const purchases=useQuery({queryKey:computed(()=>['investment-review-purchases',userId.value,selected.value?.id,portfolio.value]),queryFn:()=>api.get('/investments/funding-reviews/'+selected.value!.id+'/purchases',{portfolioId:portfolio.value}) as Promise<Purchase[]>,enabled:computed(()=>!props.reminder&&!!selected.value&&!!portfolio.value)});
const fundingMode=ref<'existing'|'add-cash'|'historical'>('existing'),existingTransfer=ref(''),fundingConfirmed=ref(false);
const nativeFunding=useQuery({queryKey:computed(()=>['investment-review-native',userId.value,selected.value?.id,portfolio.value]),queryFn:()=>api.get('/investments/funding-reviews/'+selected.value!.id+'/funding',{portfolioId:portfolio.value}) as Promise<NativeFunding>,enabled:computed(()=>!props.reminder&&!!selected.value&&!!portfolio.value&&open.value)});
async function recordFunding(){if(!selected.value||!portfolio.value||!fundingConfirmed.value)return;busy.value=true;error.value='';try{await api.post('/investments/funding-reviews/'+selected.value.id+'/funding',{portfolioId:portfolio.value,fingerprint:selected.value.fingerprint,mode:fundingMode.value,...(fundingMode.value==='existing'?{transferId:existingTransfer.value}:{})});const id=selected.value.id;await query.refetch();const updated=items.value.find(i=>i.id===id);if(updated)selected.value=updated;await nativeFunding.refetch();fundingConfirmed.value=false;await client.invalidateQueries({queryKey:['investment-funding-reviews']});}catch{error.value='Funding could not be linked. Check existing contributions, the selected account and cash history.';}finally{busy.value=false;}}
const csvText=ref(''),csvPreview=ref<CsvPreview|null>(null),csvChosen=ref<string[]>([]),confirmCash=ref(false),csvMessage=ref('');
function resetCsv(){csvText.value='';csvPreview.value=null;csvChosen.value=[];confirmCash.value=false;csvMessage.value='';}
async function previewCsv(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file||!selected.value||!portfolio.value)return;resetCsv();busy.value=true;error.value='';try{if(file.size>600000)throw Error('File is too large');csvText.value=await file.text();csvPreview.value=await api.post('/investments/funding-reviews/'+selected.value.id+'/csv/preview',{portfolioId:portfolio.value,fileContent:csvText.value}) as CsvPreview;}catch{error.value='Could not preview the CSV. Use a supported detailed export under 600 KB.';}finally{busy.value=false;}}
async function applyCsv(){if(!selected.value||!portfolio.value||!csvPreview.value||!confirmCash.value)return;busy.value=true;error.value='';try{const result=await api.post('/investments/funding-reviews/'+selected.value.id+'/csv/apply',{portfolioId:portfolio.value,fileContent:csvText.value,fileHash:csvPreview.value.fileHash,sourceRowIds:csvChosen.value,confirmCash:true}) as {created:number;existing:number;tradeIds:string[]};await purchases.refetch();const available=new Set((purchases.data.value??[]).filter(t=>!t.alreadyLinked).map(t=>t.id));chosen.value=[...new Set([...chosen.value,...result.tradeIds.filter(id=>available.has(id))])];csvMessage.value='Deposit evidence linked. '+result.created+' new purchases imported; '+result.existing+' existing purchases matched. Confirm the review below.';csvPreview.value=null;csvText.value='';csvChosen.value=[];confirmCash.value=false;await client.invalidateQueries({predicate:q=>q.queryKey.some(k=>typeof k==='string'&&/portfolio|holding|investment/i.test(k))});}catch{error.value='Import was not applied. Check the preview, recorded portfolio cash and security holdings, then retry.';}finally{busy.value=false;}}
const total=computed(()=> (purchases.data.value??[]).filter(t=>chosen.value.includes(t.id)).reduce((n,t)=>n+t.amount,0));
const money=(n:number,c:string)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(n);
watch(userId,()=>{shown.value=false;open.value=false;selected.value=null;});
watch(()=>query.data.value, result=>{if(props.reminder&&result?.reminderDue&&!shown.value){shown.value=true;open.value=true;}},{immediate:true});
watch(portfolio,()=>{chosen.value=[];cash.value=false;error.value='';resetCsv();fundingMode.value='existing';existingTransfer.value='';fundingConfirmed.value=false;});
function review(item:Item){resetCsv();selected.value=item;portfolio.value=item.portfolioId??(item.portfolios.length===1?item.portfolios[0]!.id:'');chosen.value=[];cash.value=false;error.value='';open.value=true;}
async function later(){busy.value=true;error.value='';try{await api.post('/investments/funding-reviews/snooze');open.value=false;await client.invalidateQueries({queryKey:['investment-funding-reviews']});}catch{error.value='Could not save reminder preference.';}finally{busy.value=false;}}
async function go(){open.value=false;await router.push({name:ROUTES_NAMES.investments,query:{review:'1'}});}
watch(()=>route.query.review,value=>{if(!props.reminder&&value==='1')void query.refetch();},{immediate:true});
async function resolve(){if(!selected.value||!portfolio.value)return;busy.value=true;error.value='';try{await api.post('/investments/funding-reviews/'+selected.value.id+'/resolve',{portfolioId:portfolio.value,fingerprint:selected.value.fingerprint,tradeIds:chosen.value,cashRetained:cash.value});open.value=false;selected.value=null;await client.invalidateQueries({queryKey:['investment-funding-reviews']});}catch{error.value='Could not resolve. A purchase may already be linked, or the activity changed. Refresh and try again.';}finally{busy.value=false;}}
</script>
<template>
  <section v-if="!reminder && (items.length || query.isError.value)" class="mb-4 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Activity review <span v-if="items.length" class="text-muted-foreground text-sm">({{ items.length }})</span></h2>
      <Button variant="outline" size="icon-sm" aria-label="Refresh reviews" title="Refresh reviews" @click="query.refetch()"><RefreshCwIcon class="size-4"/></Button>
    </div>
    <p v-if="query.isPending.value" class="text-muted-foreground text-sm">Checking investment activity…</p>
    <p v-else-if="query.isError.value" class="text-destructive text-sm">Could not load investment reviews.</p>
    <div v-for="item in items" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div><strong>{{ item.groupName }} · {{ money(item.amount,item.currency) }}</strong><p class="text-muted-foreground text-xs">{{ item.date }} · {{ item.reason }}</p></div>
      <Button size="sm" aria-label="Review contribution" title="Review contribution" @click="review(item)"><ClipboardCheckIcon class="size-4"/><span class="hidden sm:inline">Review</span></Button>
    </div>
  </section>
  <Dialog v-model:open="open">
    <DialogContent :class="reminder ? 'max-h-[88dvh] min-h-0 gap-3 overflow-hidden p-4 sm:p-6' : 'h-[min(88dvh,48rem)] max-h-[88dvh] min-h-0 gap-3 overflow-hidden p-4 sm:p-6'">
      <DialogHeader>
        <DialogTitle>{{ reminder ? 'Investment activity needs review' : 'Review contribution' }}</DialogTitle>
        <DialogDescription>{{ reminder ? 'Review pending investment contributions.' : 'Select a portfolio and reconcile its contribution.' }}</DialogDescription>
      </DialogHeader>
      <template v-if="reminder">
        <ScrollArea class="h-[min(40dvh,18rem)] min-h-0" viewport-class="pr-3" type="auto">
          <div class="space-y-2">
            <div v-for="item in items.slice(0,10)" :key="item.id" class="flex justify-between gap-2 rounded border p-3 text-sm">
              <span>{{ item.groupName }}<small class="text-muted-foreground block">{{ item.date }}</small></span><strong>{{ money(item.amount,item.currency) }}</strong>
            </div>
            <p v-if="items.length>10" class="text-muted-foreground text-xs">And {{ items.length-10 }} more</p>
          </div>
        </ScrollArea>
        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
        <DialogFooter class="flex-row justify-end gap-2"><Button variant="outline" :disabled="busy" aria-label="Remind me tomorrow" title="Remind me tomorrow" @click="later"><ClockIcon class="size-4"/><span class="hidden sm:inline">Tomorrow</span></Button><Button aria-label="Review investment activity" title="Review investment activity" @click="go"><ArrowRightIcon class="size-4"/><span class="hidden sm:inline">Review activity</span></Button></DialogFooter>
      </template>
      <template v-else-if="selected">
        <ScrollArea class="min-h-0 flex-1 basis-0" viewport-class="pr-3" type="auto">
          <div class="space-y-3 text-sm">
            <p class="font-semibold">{{ selected.groupName }} · {{ money(selected.amount,selected.currency) }} · {{ selected.date }}</p>
            <label class="block">Destination portfolio
              <select v-model="portfolio" :disabled="!!selected.portfolioId" class="bg-background block w-full rounded border p-2"><option value="">Select portfolio</option><option v-for="p in selected.portfolios" :key="p.id" :value="p.id">{{ p.name }}</option></select>
            </label>
            <template v-if="portfolio">
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" as-child><RouterLink :to="{name:ROUTES_NAMES.portfolioDetail,params:{portfolioId:portfolio}}" aria-label="Enter purchases" title="Enter purchases" @click="open=false"><PlusIcon class="size-4"/><span class="hidden sm:inline">Enter purchases</span></RouterLink></Button>
                <Button variant="outline" size="icon-sm" aria-label="Refresh purchases" title="Refresh purchases" @click="purchases.refetch()"><RefreshCwIcon class="size-4"/></Button>
              </div>
              <div class="space-y-2 rounded border p-3">
                <p class="font-semibold">Portfolio contribution</p>
                <p v-if="nativeFunding.isPending.value" class="text-muted-foreground text-xs">Checking existing funding…</p>
                <p v-else-if="nativeFunding.isError.value||nativeFunding.data.value?.conflict" class="text-destructive text-xs">Funding needs manual review before another contribution can be recorded.</p>
                <p v-else-if="nativeFunding.data.value?.linked" class="text-muted-foreground text-xs">Contribution linked.</p>
                <template v-else-if="nativeFunding.data.value">
                  <p class="text-muted-foreground text-xs">Only add cash if the deposit is missing.</p>
                  <select v-model="fundingMode" class="bg-background block w-full rounded border p-2">
                    <option value="existing">Link existing contribution</option><option value="add-cash" :disabled="!!nativeFunding.data.value.candidates.length">Record missing contribution and add cash</option><option value="historical" :disabled="!!nativeFunding.data.value.candidates.length">Record historical contribution without changing cash</option>
                  </select>
                  <select v-if="fundingMode==='existing'" v-model="existingTransfer" class="bg-background block w-full rounded border p-2">
                    <option value="">Select existing contribution</option><option v-for="candidate in nativeFunding.data.value.candidates.filter(c=>c.portfolioId===portfolio)" :key="candidate.id" :value="candidate.id">{{ candidate.date }} · {{ money(candidate.amount,selected.currency) }}</option>
                  </select>
                  <p v-if="nativeFunding.data.value.candidates.length&&!nativeFunding.data.value.candidates.some(c=>c.portfolioId===portfolio)" class="text-destructive text-xs">A possible contribution exists in another member portfolio. Select that portfolio to review it.</p>
                  <label class="flex items-start gap-2 text-xs"><input v-model="fundingConfirmed" type="checkbox"/><span>I verified the destination, contribution history and whether this money is already reflected in cash.</span></label>
                  <Button size="sm" :disabled="busy||!fundingConfirmed||(fundingMode==='existing'&&!existingTransfer)||(fundingMode!=='existing'&&!!nativeFunding.data.value.candidates.length)" @click="recordFunding">Link or record contribution</Button>
                </template>
              </div>
              <div class="space-y-2 rounded border p-3">
                <p class="font-semibold">Brokerage CSV reconciliation</p>
                <p class="text-muted-foreground text-xs">M1 or Robinhood activity CSV</p>
                <input type="file" accept=".csv,text/csv" :disabled="busy" class="block w-full text-xs" @change="previewCsv"/>
                <p v-if="csvMessage" class="text-xs">{{ csvMessage }}</p>
                <template v-if="csvPreview">
                  <p>{{ csvPreview.totalRows }} rows · {{ csvPreview.matched }} existing buys · {{ csvPreview.newBuys }} eligible new buys · {{ csvPreview.review }} review buys</p>
                  <p :class="csvPreview.depositStatus==='unique'?'text-muted-foreground':'text-destructive'">{{ csvPreview.depositStatus==='unique'?'One matching deposit; no additional funding will be created.':csvPreview.depositStatus==='ambiguous'?'Multiple possible deposits — manual review required.':'No matching deposit in the file.' }}</p>
                  <label v-for="row in csvPreview.rows" :key="row.sourceRowId" class="flex items-start gap-2 rounded border p-2 text-xs" :class="row.status==='review'?'opacity-60':''">
                    <input v-model="csvChosen" type="checkbox" :value="row.sourceRowId" :disabled="row.status==='review'||busy"/><span class="flex-1">{{ row.date }} · {{ row.symbol }} · {{ row.quantity }} shares<small class="text-muted-foreground block">{{ row.status }} · {{ row.reason }}</small></span><strong>{{ money(Number(row.amount),selected.currency) }}</strong>
                  </label>
                  <label class="flex items-start gap-2 text-xs"><input v-model="confirmCash" type="checkbox"/><span>I confirm the CSV belongs to this portfolio, the deposit is already represented in its cash, and selected missing purchases are not already included in holdings.</span></label>
                  <Button size="sm" :disabled="busy||!confirmCash||csvPreview.depositStatus!=='unique'||csvChosen.length>50" @click="applyCsv">Apply selected rows ({{ csvChosen.length }})</Button>
                </template>
              </div>
              <p v-if="purchases.isPending.value">Loading recorded purchases…</p>
              <p v-else-if="purchases.isError.value" class="text-destructive">Could not load purchases.</p>
              <p v-else-if="!purchases.data.value?.length" class="text-muted-foreground">No recorded purchases in this review window.</p>
              <label v-for="trade in purchases.data.value??[]" :key="trade.id" class="flex items-center gap-2 rounded border p-2" :class="trade.alreadyLinked?'opacity-50':''">
                <input v-model="chosen" type="checkbox" :value="trade.id" :disabled="trade.alreadyLinked"/><span class="flex-1">{{ trade.symbol }} · {{ trade.quantity }} shares <small class="text-muted-foreground block">{{ trade.date }}{{ trade.alreadyLinked?' · already linked':'' }}</small></span><strong>{{ money(trade.amount,trade.currency) }}</strong>
              </label>
              <p>Selected purchases: <strong>{{ money(total,selected.currency) }}</strong></p>
              <label class="flex items-start gap-2"><input v-model="cash" type="checkbox"/> <span>I confirm any remaining contribution was intentionally held in cash.</span></label>
            </template>
            <p v-if="error" class="text-destructive" role="alert">{{ error }}</p>
          </div>
        </ScrollArea>
        <DialogFooter class="flex-row justify-end gap-2"><Button variant="outline" aria-label="Cancel" title="Cancel" @click="open=false"><XIcon class="size-4"/><span class="hidden sm:inline">Cancel</span></Button><Button :disabled="busy||!portfolio||(!cash&&total<selected.amount-0.01)" aria-label="Resolve review" title="Resolve review" @click="resolve"><CheckIcon class="size-4"/><span class="hidden sm:inline">Resolve review</span></Button></DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
