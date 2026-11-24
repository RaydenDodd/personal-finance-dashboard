<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { SettingsIcon } from '@lucide/vue';

defineProps<{
  isEditMode: boolean;
  isSaving?: boolean;
  compactOnMobile?: boolean;
}>();

const emit = defineEmits<{
  enter: [];
  save: [];
  cancel: [];
}>();
</script>

<template>
  <div class="flex items-center gap-2">
    <template v-if="isEditMode">
      <Button variant="outline" size="sm" :disabled="isSaving" @click="emit('cancel')">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button size="sm" :disabled="isSaving" @click="emit('save')"> {{ $t('common.actions.done') }} </Button>
    </template>
    <template v-else>
      <Button
        variant="outline"
        size="sm"
        :class="compactOnMobile ? 'max-sm:size-8 max-sm:shrink-0 max-sm:p-0' : ''"
        :aria-label="$t('dashboard.editMode.customize')"
        :title="$t('dashboard.editMode.customize')"
        @click="emit('enter')"
      >
        <SettingsIcon class="size-3.5" />
        <span :class="compactOnMobile ? 'hidden sm:inline' : ''">{{ $t('dashboard.editMode.customize') }}</span>
      </Button>
    </template>
  </div>
</template>
