-- Custom SQL migration file, put your code below! --
-- The fork's rename (GitOrange -> CloudForge): decisions GitOrange AI made were recorded with via = 'GitOrange AI',
-- which the code compares against (AI_VIA). Rewrites them to the new name so existing deployments keep reading them
-- as AI decisions.
UPDATE `pr_review_flags` SET `approved_via` = 'CloudForge AI' WHERE `approved_via` = 'GitOrange AI';--> statement-breakpoint
UPDATE `pr_approvals` SET `via` = 'CloudForge AI' WHERE `via` = 'GitOrange AI';--> statement-breakpoint
UPDATE `audit_events` SET `via` = 'CloudForge AI' WHERE `via` = 'GitOrange AI';--> statement-breakpoint
UPDATE `pr_events` SET `data` = json_set(`data`, '$.via', 'CloudForge AI') WHERE json_valid(`data`) AND json_extract(`data`, '$.via') = 'GitOrange AI';
