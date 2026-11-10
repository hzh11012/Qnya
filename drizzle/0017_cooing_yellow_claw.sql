CREATE TYPE "public"."app_platform" AS ENUM('android', 'windows', 'ios', 'macos');--> statement-breakpoint
ALTER TABLE "app_releases" ADD COLUMN "platform" "app_platform" DEFAULT 'android' NOT NULL;