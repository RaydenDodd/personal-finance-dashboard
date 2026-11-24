import unittest
from report_visuals import render_report, COLORS
class ReportVisualTests(unittest.TestCase):
    def report(self):
        data={'from':'2026-11-16','through':'2026-11-22','grossCents':12345,'refundCents':2000,'netCents':10345,'categoriesCents':{'Food <&>':12345},'dailyCents':{'2026-11-17':12345},'pendingCount':2,'excludedCount':3,'review':[{'date':'2026-11-17','merchant':'<script>','amountCents':500}], 'warnings':[]}
        return {'week':data,'weekend':{**data,'from':'2026-11-20'},'sync':{'complete':False,'warning':'Bank delayed'},'classifier':{'complete':True},'categoryStyles':{'Food <&>':{'color':'#C14F3B'}}}
    def test_preserves_totals_and_category_colors(self):
        report=self.report();output=render_report(report)
        self.assertIn('$103.45',output);self.assertIn('#C14F3B',output)
        self.assertEqual(report['week']['netCents'],10345)
        self.assertIn('weekend is included in the week',output)
        self.assertIn('Bank delayed',output);self.assertIn('Purchases by day',output)
    def test_escapes_text_and_rejects_css_injection(self):
        report=self.report();report['categoryStyles']['Food <&>']['color']='red;position:fixed'
        output=render_report(report)
        self.assertNotIn('<script>',output);self.assertNotIn('position:fixed',output)
        self.assertIn('&lt;script&gt;',output);self.assertIn('Food &lt;&amp;&gt;',output)
    def test_existing_cached_reports_without_daily_data_remain_supported(self):
        report=self.report();report.pop('categoryStyles');report['week'].pop('dailyCents')
        self.assertIn('$103.45',render_report(report))
        self.assertEqual(COLORS['savings'],'#EAB308')
if __name__=='__main__':unittest.main()
