CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"model" text NOT NULL,
	"model_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"system_prompt_version" text NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"tool_version" text NOT NULL,
	"adapter" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"role" text DEFAULT 'engineer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "assertions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"result_id" text NOT NULL,
	"assertion_key" text NOT NULL,
	"layer" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"passed" boolean NOT NULL,
	"score" double precision NOT NULL,
	"severity" text NOT NULL,
	"hard_gate" boolean NOT NULL,
	"invariant_code" text,
	"message" text NOT NULL,
	"expected" text,
	"actual" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scenario_code" text NOT NULL,
	"scenario_version" integer NOT NULL,
	"scenario_name" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"parent_scenario_code" text,
	"mutation_strategy" text,
	"status" text NOT NULL,
	"outcome_passed" boolean NOT NULL,
	"trajectory_passed" boolean NOT NULL,
	"hard_gate_failed" boolean NOT NULL,
	"scores" jsonb NOT NULL,
	"operational" jsonb NOT NULL,
	"first_divergence" jsonb,
	"expected_trajectory" jsonb NOT NULL,
	"actual_trajectory" jsonb NOT NULL,
	"judgments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"latency_ms" double precision NOT NULL,
	"cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"agent_version" text NOT NULL,
	"scenario_set_id" text,
	"mode" text NOT NULL,
	"label" text,
	"evaluator_version" text NOT NULL,
	"status" text NOT NULL,
	"progress_completed" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"total_scenarios" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errored" integer DEFAULT 0 NOT NULL,
	"critical_failures" integer DEFAULT 0 NOT NULL,
	"major_failures" integer DEFAULT 0 NOT NULL,
	"minor_failures" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"config" jsonb,
	"baseline_run_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "failure_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"failure_id" text NOT NULL,
	"trace_step" integer,
	"explanation" text NOT NULL,
	"fact" jsonb
);
--> statement-breakpoint
CREATE TABLE "failures" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"result_id" text,
	"scenario_code" text NOT NULL,
	"agent_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"severity" text NOT NULL,
	"first_divergence_step" integer,
	"first_divergence" jsonb,
	"expected_behavior" text NOT NULL,
	"actual_behavior" text NOT NULL,
	"violated_invariant" jsonb,
	"likely_cause" text NOT NULL,
	"recommendation" text NOT NULL,
	"assertion_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regression" boolean DEFAULT false NOT NULL,
	"previous_passing_version" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invariants" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"dimension" text NOT NULL,
	"value" double precision,
	"sample_size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"redaction_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "regressions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"baseline_run_id" text NOT NULL,
	"candidate_run_id" text NOT NULL,
	"new_failures" integer NOT NULL,
	"fixed" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_gate_results" (
	"id" text PRIMARY KEY NOT NULL,
	"gate_id" text NOT NULL,
	"run_id" text NOT NULL,
	"baseline_run_id" text,
	"decision" text NOT NULL,
	"checks" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"report" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_gates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text,
	"name" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_mutations" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_scenario_id" text NOT NULL,
	"child_scenario_id" text NOT NULL,
	"strategy" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_set_members" (
	"set_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	CONSTRAINT "scenario_set_members_set_id_scenario_id_pk" PRIMARY KEY("set_id","scenario_id")
);
--> statement-breakpoint
CREATE TABLE "scenario_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'suite' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"parent_code" text,
	"mutation_strategy" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"destructive" boolean DEFAULT false NOT NULL,
	"current_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"idx" integer NOT NULL,
	"type" text NOT NULL,
	"tool" text,
	"status" text,
	"offset_ms" double precision NOT NULL,
	"duration_ms" double precision NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"result_id" text,
	"scenario_code" text NOT NULL,
	"agent_version" text NOT NULL,
	"model" text NOT NULL,
	"seed" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"totals" jsonb NOT NULL,
	"initial_state" jsonb NOT NULL,
	"final_state" jsonb NOT NULL,
	"infrastructure_error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_result_id_evaluation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."evaluation_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_scenario_set_id_scenario_sets_id_fk" FOREIGN KEY ("scenario_set_id") REFERENCES "public"."scenario_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_evidence" ADD CONSTRAINT "failure_evidence_failure_id_failures_id_fk" FOREIGN KEY ("failure_id") REFERENCES "public"."failures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_result_id_evaluation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."evaluation_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invariants" ADD CONSTRAINT "invariants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regressions" ADD CONSTRAINT "regressions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regressions" ADD CONSTRAINT "regressions_baseline_run_id_evaluation_runs_id_fk" FOREIGN KEY ("baseline_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regressions" ADD CONSTRAINT "regressions_candidate_run_id_evaluation_runs_id_fk" FOREIGN KEY ("candidate_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_gate_results" ADD CONSTRAINT "release_gate_results_gate_id_release_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."release_gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_gate_results" ADD CONSTRAINT "release_gate_results_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_gates" ADD CONSTRAINT "release_gates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_gates" ADD CONSTRAINT "release_gates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_mutations" ADD CONSTRAINT "scenario_mutations_parent_scenario_id_scenarios_id_fk" FOREIGN KEY ("parent_scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_mutations" ADD CONSTRAINT "scenario_mutations_child_scenario_id_scenarios_id_fk" FOREIGN KEY ("child_scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_set_members" ADD CONSTRAINT "scenario_set_members_set_id_scenario_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."scenario_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_set_members" ADD CONSTRAINT "scenario_set_members_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_sets" ADD CONSTRAINT "scenario_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_versions" ADD CONSTRAINT "tool_versions_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_steps" ADD CONSTRAINT "trace_steps_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_version" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_project_slug" ON "agents" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "assertions_result" ON "assertions" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "audit_project_created" ON "audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "results_run" ON "evaluation_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "results_scenario" ON "evaluation_results" USING btree ("scenario_code");--> statement-breakpoint
CREATE INDEX "runs_project_created" ON "evaluation_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_agent_version" ON "evaluation_runs" USING btree ("agent_version_id");--> statement-breakpoint
CREATE INDEX "failure_evidence_failure" ON "failure_evidence" USING btree ("failure_id");--> statement-breakpoint
CREATE INDEX "failures_run" ON "failures" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "failures_project_severity" ON "failures" USING btree ("project_id","severity");--> statement-breakpoint
CREATE INDEX "failures_fingerprint" ON "failures" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "invariants_project_code" ON "invariants" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "metrics_run" ON "metrics" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_sets_project_slug" ON "scenario_sets" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_versions_scenario_version" ON "scenario_versions" USING btree ("scenario_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_project_code" ON "scenarios" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "scenarios_category" ON "scenarios" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_project_name" ON "secrets" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_versions_tool_version" ON "tool_versions" USING btree ("tool_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_project_name" ON "tools" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "trace_steps_trace" ON "trace_steps" USING btree ("trace_id","idx");--> statement-breakpoint
CREATE INDEX "traces_run" ON "traces" USING btree ("run_id");