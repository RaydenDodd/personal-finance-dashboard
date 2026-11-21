import { ASSET_CLASS } from '@bt/shared/types/investments';
import type Securities from '@models/investments/securities.model';

/** Exchange identity, rather than issuer headquarters, identifies the regular US session. */
export function usesUsEquitySession(
  s: Pick<Securities, 'assetClass' | 'currencyCode' | 'exchangeMic' | 'exchangeAcronym'>,
) {
  return (
    s.assetClass === ASSET_CLASS.stocks &&
    s.currencyCode === 'USD' &&
    [s.exchangeMic, s.exchangeAcronym].some((v) =>
      /^(XNAS|XNYS|ARCX|NASDAQ|NYSE|NMS|NAS|NGM|NCM|NYQ|PCX|ARCA|NYSEARCA|ASE|AMEX|XASE|PNK|OTC|OTCQX|OTCQB|BTS|BATS|OBB)$/i.test(
        v ?? '',
      ),
    )
  );
}
