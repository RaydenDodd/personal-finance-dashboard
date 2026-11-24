"""Email-safe presentation only; financial totals and stored category colors are unchanged."""
import datetime as dt
import html
import json
from pathlib import Path
import re

COLORS = json.loads((Path(__file__).resolve().parents[2] / 'packages/shared/src/financial-colors.json').read_text())['colors']

def render_report(report):
    esc = lambda value: html.escape(str(value), quote=True)
    money = lambda cents: f'${cents / 100:,.2f}'
    styles = report.get('categoryStyles', {})
    def category_color(name):
        color = styles.get(name, {}).get('color', '')
        return color if re.fullmatch(r'#[0-9a-fA-F]{6}', color) else COLORS['deductions']
    blocks = []
    for state, title in [('sync', 'Incomplete bank data'), ('classifier', 'Classification incomplete')]:
        if report.get(state, {}).get('complete') is False:
            blocks.append(f'<p style="padding:14px;border-left:4px solid {COLORS["liabilities"]};background:#29221c"><b>{title}</b><br>{esc(report[state].get("warning", "Review required"))}</p>')
    for key, title in [('week', 'Your full week'), ('weekend', 'Friday–Sunday')]:
        data = report[key]
        categories = sorted(data['categoriesCents'].items(), key=lambda pair: -pair[1])
        maximum = max([amount for _, amount in categories] + [1])
        bars = ''.join(f'<tr><td style="padding:10px 0;width:65%"><span style="color:{category_color(name)}">●</span> {esc(name)}<div style="margin-top:6px;background:#333;height:8px;border-radius:4px"><div style="width:{max(1, amount/maximum*100):.2f}%;height:8px;background:{category_color(name)};border-radius:4px"></div></div></td><td style="text-align:right;padding-left:12px">{money(amount)}</td></tr>' for name, amount in categories)
        daily = data.get('dailyCents', {})
        daily_chart = ''
        if daily:
            first = dt.date.fromisoformat(data['from']); last = dt.date.fromisoformat(data['through'])
            days = [first + dt.timedelta(days=i) for i in range((last-first).days+1)]
            peak = max([daily.get(str(day), 0) for day in days] + [1])
            cells = ''.join(f'<td style="vertical-align:bottom;text-align:center;width:{100/len(days):.1f}%"><div style="font-size:10px;padding-bottom:6px">{money(daily.get(str(day),0))}</div><div style="margin:0 5px;height:{max(2, daily.get(str(day),0)/peak*90):.0f}px;background:{COLORS["deductions"]};border-radius:4px 4px 0 0"></div><div style="font-size:11px;padding-top:7px;color:#bbb">{day.strftime("%a")}</div></td>' for day in days)
            daily_chart = f'<h3 style="font-size:14px">Purchases by day</h3><table role="presentation" style="width:100%;table-layout:fixed"><tr>{cells}</tr></table>'
        notices = ''.join(f'<p style="font-size:12px;color:#ccc">{esc(warning)}</p>' for warning in data.get('warnings', []))
        blocks.append(f'<section style="background:#201f1d;border:1px solid #393735;border-radius:14px;padding:20px;margin:18px 0"><h2 style="margin:0;font-size:20px">{title}</h2><p style="color:#bbb;font-size:12px">{esc(data["from"])} → {esc(data["through"])} · Eastern</p><div style="font-size:12px;color:#bbb">NET SPENDING</div><div style="font-size:36px;font-weight:700;margin:5px 0 14px">{money(data["netCents"])}</div><table role="presentation" style="width:100%"><tr><td>Purchases<br><b>{money(data["grossCents"])}</b></td><td style="text-align:right">Linked refunds<br><b style="color:{COLORS["income"]}">{money(data["refundCents"])}</b></td></tr></table>{daily_chart}<h3 style="font-size:14px;margin-top:24px">Where it went</h3><table role="presentation" style="width:100%">{bars or "<tr><td>No posted purchases.</td></tr>"}</table><p style="font-size:12px;color:#bbb">{data["pendingCount"]} pending purchases excluded · {data["excludedCount"]} non-purchase records excluded</p>{notices}</section>')
    review = report['week'].get('review', [])
    rows = ''.join(f'<tr><td style="padding:8px 0;border-bottom:1px solid #393735">{esc(row["merchant"])}<br><small style="color:#bbb">{esc(row["date"])} · {esc(row.get("suggestion", "Review needed"))}</small></td><td style="text-align:right">{money(row["amountCents"])}</td></tr>' for row in review[:12])
    review_html = f'<h2 style="font-size:20px">Categorization checkup · {len(review)}</h2><table role="presentation" style="width:100%">{rows}</table>' if review else '<p>✓ All posted purchases have a category.</p>'
    return f'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#131211;color:#f5f5f5;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;padding:22px 14px"><h1 style="font-size:26px;margin-bottom:6px">MoneyMatter spending checkup</h1><p style="color:#bbb;font-size:13px">A full-week recap, plus your Friday–Sunday weekend. The weekend is included in the week, not added to it.</p>{"".join(blocks)}{review_html}<p style="margin:24px 0"><a href="https://raydenfinance.duckdns.org/transactions" style="display:inline-block;background:#7864bc;color:white;text-decoration:none;padding:14px 20px;border-radius:10px">Review transactions</a></p><p style="color:#aaa;font-size:12px;line-height:1.6">Transfers, credit-card payments and recognized investment movements are excluded. Category colors match your MoneyMatter categories. Totals use posted records; late postings and refunds can change them.</p></div></body></html>'
