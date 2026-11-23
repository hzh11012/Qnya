CREATE TYPE "public"."watch_room_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."watch_room_message_type" AS ENUM('chat', 'system');--> statement-breakpoint
CREATE TYPE "public"."watch_room_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "watch_room_bans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_room_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "watch_room_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_room_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "watch_room_message_type" NOT NULL,
	"event_type" varchar(50),
	"content" varchar(500) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"announcement" varchar(500),
	"visibility" "watch_room_visibility" NOT NULL,
	"password_hash" text,
	"max_members" integer DEFAULT 5 NOT NULL,
	"current_video_id" uuid,
	"playback_position" real DEFAULT 0 NOT NULL,
	"is_playing" boolean DEFAULT false NOT NULL,
	"playback_revision" integer DEFAULT 0 NOT NULL,
	"playback_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_room_bans" ADD CONSTRAINT "watch_room_bans_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_room_bans" ADD CONSTRAINT "watch_room_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_room_members" ADD CONSTRAINT "watch_room_members_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_room_members" ADD CONSTRAINT "watch_room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_room_messages" ADD CONSTRAINT "watch_room_messages_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_room_messages" ADD CONSTRAINT "watch_room_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_rooms" ADD CONSTRAINT "watch_rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_rooms" ADD CONSTRAINT "watch_rooms_current_video_id_videos_id_fk" FOREIGN KEY ("current_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_watch_room_bans_room_user" ON "watch_room_bans" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "watch_room_members_room_idx" ON "watch_room_members" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_watch_room_members_user" ON "watch_room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watch_room_messages_room_created_idx" ON "watch_room_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "watch_rooms_owner_idx" ON "watch_rooms" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "watch_rooms_visibility_idx" ON "watch_rooms" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "watch_rooms_created_idx" ON "watch_rooms" USING btree ("created_at");