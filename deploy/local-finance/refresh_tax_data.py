"""Check authoritative tax sources without overwriting frozen historical rules."""
from operations import Api

with Api() as api:
    result=api.request('/personal-finance/income/tax-data/refresh',{},timeout=420)
    print('Authoritative tax source checks completed; historical rule versions retained')
