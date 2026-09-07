ALTER TABLE "anime" ADD CONSTRAINT "anime_series_season_unique" UNIQUE("series_id","season");--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_anime_episode_unique" UNIQUE("anime_id","episode");
