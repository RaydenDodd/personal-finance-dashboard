import type { QueryInterface } from 'sequelize';
module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.query(`
 CREATE FUNCTION investment_history_source_security_changed() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE r jsonb; previous jsonb; sid UUID; pid UUID; d DATE;
 BEGIN
 r=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 previous=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 sid=CASE WHEN TG_TABLE_NAME='Securities' THEN (r->>'id')::uuid ELSE (r->>'securityId')::uuid END;
 IF TG_TABLE_NAME='SecurityPricings' THEN
  IF TG_OP='UPDATE' AND r->'date'=previous->'date' AND r->'priceClose'=previous->'priceClose' AND r->'unadjustedClose' IS NOT DISTINCT FROM previous->'unadjustedClose' AND r->'priceAsOf' IS NOT DISTINCT FROM previous->'priceAsOf' AND r->'previousClose' IS NOT DISTINCT FROM previous->'previousClose' THEN RETURN NULL;END IF;
  d=CASE WHEN r->>'priceAsOf' IS NULL THEN (r->>'date')::date ELSE ((r->>'priceAsOf')::timestamptz AT TIME ZONE 'America/New_York')::date END;
  IF TG_OP='UPDATE' THEN d=LEAST(d,(previous->>'date')::date-1);END IF;
 ELSE d='1900-01-01'::date;END IF;
 FOR pid IN SELECT h."portfolioId" FROM "InvestmentHistoryState" h
 WHERE h.audit->'securities' @> jsonb_build_array(jsonb_build_object('id',sid::text))
 AND NOT EXISTS(SELECT 1 FROM "InvestmentTransactions" t WHERE t."portfolioId"=h."portfolioId" AND t."securityId"=sid)
 AND NOT EXISTS(SELECT 1 FROM "Holdings" t WHERE t."portfolioId"=h."portfolioId" AND t."securityId"=sid)
 LOOP PERFORM investment_history_dirty(pid,d);END LOOP;
 RETURN NULL;
 END $$;
 CREATE TRIGGER investment_history_source_only_prices AFTER INSERT OR UPDATE OR DELETE ON "SecurityPricings" FOR EACH ROW EXECUTE FUNCTION investment_history_source_security_changed();
 CREATE TRIGGER investment_history_source_only_metadata AFTER UPDATE OF "currencyCode","assetClass",symbol,"providerSymbol" ON "Securities" FOR EACH ROW WHEN (OLD."currencyCode" IS DISTINCT FROM NEW."currencyCode" OR OLD."assetClass" IS DISTINCT FROM NEW."assetClass" OR OLD.symbol IS DISTINCT FROM NEW.symbol OR OLD."providerSymbol" IS DISTINCT FROM NEW."providerSymbol") EXECUTE FUNCTION investment_history_source_security_changed();
 `);
  },
  down: async (q: QueryInterface) => {
    await q.sequelize.query(
      'DROP TRIGGER investment_history_source_only_prices ON "SecurityPricings";DROP TRIGGER investment_history_source_only_metadata ON "Securities";DROP FUNCTION investment_history_source_security_changed();',
    );
  },
};
