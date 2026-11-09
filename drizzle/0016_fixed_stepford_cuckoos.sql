CREATE TABLE "app_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_code" integer,
	"version_name" text NOT NULL,
	"url" text NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_releases_version_code_idx" ON "app_releases" USING btree ("version_code");