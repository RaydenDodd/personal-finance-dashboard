import type { DashboardWidgetConfig } from '@/api/user-settings';
import type { WidgetLayoutDefinition } from '@/components/widgets/widget-registry';

export function pageBlock(
  id: string,
  name: string,
  description: string,
  columns: 3 | 4 = 3,
  defaultColSpan = 3,
): WidgetLayoutDefinition {
  return {
    id,
    name,
    description,
    literalLabels: true,
    defaultColSpan,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: columns === 4 ? '1/4' : '1/3' },
      { colSpan: 2, rowSpan: 1, label: columns === 4 ? '1/2' : '2/3' },
      { colSpan: 3, rowSpan: 1, label: 'Full' },
    ],
  };
}
export const defaultPageLayout = (registry: Record<string, WidgetLayoutDefinition>): DashboardWidgetConfig[] =>
  Object.values(registry).map((d) => ({ widgetId: d.id, colSpan: d.defaultColSpan, rowSpan: d.defaultRowSpan }));
