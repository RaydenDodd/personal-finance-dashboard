import { currentTheme } from '@/common/utils/color-theme';
import { FINANCIAL_COLORS, NET_WORTH_COLORS } from '@bt/shared/financial-colors';
import { watchEffect } from 'vue';
export function installFinancialColors() {
  for (const [key, value] of Object.entries(FINANCIAL_COLORS)) {
    document.documentElement.style.setProperty(
      '--financial-' + key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase()),
      value,
    );
  }
  watchEffect(() =>
    document.documentElement.style.setProperty('--financial-net-worth', NET_WORTH_COLORS[currentTheme.value]),
  );
}
