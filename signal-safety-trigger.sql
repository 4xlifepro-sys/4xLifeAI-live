-- Database-level safeguard: prevent impossible signal outcomes
-- This trigger rejects any update/insert that sets result='INVALID' while also
-- claiming the trade won (pips_won > 0) or had a TP hit.

CREATE OR REPLACE FUNCTION enforce_signal_result_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- Block INVALID + win at the same time
  IF NEW.result = 'INVALID' AND (NEW.pips_won > 0 OR NEW.pips_won IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Inconsistent signal outcome: result=INVALID cannot have pips_won > 0 (id=%, pair=%)', NEW.id, NEW.pair;
  END IF;

  -- Block INVALID + any TP hit timestamp
  IF NEW.result = 'INVALID' AND (NEW.tp1_hit_at IS NOT NULL OR NEW.tp2_hit_at IS NOT NULL OR NEW.tp3_hit_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Inconsistent signal outcome: result=INVALID cannot have TP hits (id=%, pair=%)', NEW.id, NEW.pair;
  END IF;

  -- Block SL equal to entry on closed trades with pips_won > 0 (corrupted SL overwrite)
  IF NEW.is_active = false 
     AND NEW.entry_price IS NOT NULL 
     AND NEW.sl IS NOT NULL 
     AND ABS(NEW.entry_price - NEW.sl) < 1e-12
     AND (NEW.pips_won > 0 OR NEW.tp1_hit_at IS NOT NULL OR NEW.tp2_hit_at IS NOT NULL OR NEW.tp3_hit_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Inconsistent signal outcome: SL cannot equal entry on a winning/TP-hit trade (id=%, pair=%)', NEW.id, NEW.pair;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS signal_result_consistency_trigger ON signals;

-- Attach trigger to signals table
CREATE TRIGGER signal_result_consistency_trigger
BEFORE INSERT OR UPDATE ON signals
FOR EACH ROW
EXECUTE FUNCTION enforce_signal_result_consistency();
