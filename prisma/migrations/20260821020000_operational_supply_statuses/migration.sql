UPDATE "supply_requests"
SET "status" = CASE "status"
  WHEN 'Pending' THEN 'Requested'
  WHEN 'EmailSent' THEN 'Approved'
  WHEN 'Email Sent' THEN 'Approved'
  WHEN 'Completed' THEN 'Delivered'
  ELSE "status"
END;

UPDATE "supply_status_events"
SET
  "fromStatus" = CASE "fromStatus"
    WHEN 'Pending' THEN 'Requested'
    WHEN 'EmailSent' THEN 'Approved'
    WHEN 'Email Sent' THEN 'Approved'
    WHEN 'Completed' THEN 'Delivered'
    ELSE "fromStatus"
  END,
  "toStatus" = CASE "toStatus"
    WHEN 'Pending' THEN 'Requested'
    WHEN 'EmailSent' THEN 'Approved'
    WHEN 'Email Sent' THEN 'Approved'
    WHEN 'Completed' THEN 'Delivered'
    ELSE "toStatus"
  END;

ALTER TABLE "supply_requests" ALTER COLUMN "status" SET DEFAULT 'Requested';
