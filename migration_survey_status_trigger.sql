-- Trigger to automatically update Survey Status to 'responded'
-- This ensures the status updates even if the user (public/anon) doesn't have direct UPDATE permission on the survey table.

-- 1. Create the Function
CREATE OR REPLACE FUNCTION update_survey_status_on_response()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the parent survey's status to 'responded'
  UPDATE surveys
  SET status = 'responded'
  WHERE id = NEW.survey_id
  AND status = 'published'; -- Only update if it was 'published' (don't overwrite 'completed' etc)
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; -- SECURITY DEFINER allows this to run with owner permissions, bypassing RLS

-- 2. Create the Trigger
DROP TRIGGER IF EXISTS on_response_submitted ON responses;

CREATE TRIGGER on_response_submitted
AFTER INSERT ON responses
FOR EACH ROW
EXECUTE FUNCTION update_survey_status_on_response();
