CREATE TYPE "public"."account_type" AS ENUM('CREDIT', 'BANK');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('UPDATED', 'UPDATING', 'LOGIN_ERROR', 'WAITING_USER_INPUT', 'OUTDATED');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"pluggy_account_id" text NOT NULL,
	"type" "account_type" NOT NULL,
	"name" text NOT NULL,
	"last4" text,
	"due_day" integer,
	"closing_day" integer,
	"credit_limit_cents" bigint
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"pluggy_item_id" text NOT NULL,
	"institution" text NOT NULL,
	"status" "connection_status" DEFAULT 'UPDATING' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_pluggy_unique" ON "account" USING btree ("pluggy_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_item_unique" ON "connection" USING btree ("pluggy_item_id");