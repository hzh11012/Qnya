ALTER TABLE "watch_room_invites" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "watch_room_invites" CASCADE;--> statement-breakpoint
DROP INDEX "watch_room_members_room_status_idx";--> statement-breakpoint
DROP INDEX "uq_watch_room_members_active_user";--> statement-breakpoint
CREATE INDEX "watch_room_members_room_idx" ON "watch_room_members" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_watch_room_members_user" ON "watch_room_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "watch_room_members" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "watch_room_members" DROP COLUMN "last_seen_at";--> statement-breakpoint
DROP TYPE "public"."watch_room_member_status";